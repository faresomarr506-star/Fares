// telegram.js
// إرسال تنبيهات تيليجرام عبر Telegram Bot API مباشرة (بدون الاعتماد على بوت poller الرئيسي)
// يستخدم TELEGRAM_ALERTS_BOT_TOKEN و TELEGRAM_ALERTS_CHAT_ID إن وُجدا، وإلا يعود إلى TELEGRAM_TOKEN و DEVELOPER_ID
// في حال فشل الإرسال لا يكسر البوت — يُسجَّل الخطأ فقط وترسل إعادة المحاولة بأمان

const https = require('https')
const { URL } = require('url')
const config = require('./config')

const LOG_PREFIX = '[telegram-alerts]'
const LAST_ERRORS = [] // دائرة محدودة بأخطاء الإرسال الأخيرة للمشاهدة من /api/admin/monitor

function pickToken() {
  return String(config.TELEGRAM_ALERTS_BOT_TOKEN || config.TELEGRAM_TOKEN || '').trim()
}
function pickChatId() {
  return String(config.TELEGRAM_ALERTS_CHAT_ID || config.DEVELOPER_ID || '').trim()
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function trimText(text, max = 3500) {
  const str = String(text || '')
  if (str.length <= max) return str
  return str.slice(0, max - 32) + '\n\n…(تم اختصار الرسالة)…'
}

function pushError(reason, extra) {
  LAST_ERRORS.unshift({ at: Date.now(), reason, extra })
  if (LAST_ERRORS.length > 20) LAST_ERRORS.length = 20
}

function getRecentErrors() {
  return LAST_ERRORS.slice(0, 10)
}

/**
 * إرسال رسالة HTML عبر Telegram Bot API.
 * @param {string} chatId أو نص — إن لم يُمرَّر يستخدم chatId الافتراضي
 * @param {string} text
 * @returns {Promise<{ok:boolean, statusCode?:number, data?:any, error?:string}>}
 */
async function sendAlert(text, chatId = null) {
  const token = pickToken()
  const targetChat = String(chatId || pickChatId() || '').trim()
  if (!token) { pushError('missing-token', null); return { ok: false, error: 'لا يوجد TELEGRAM_ALERTS_BOT_TOKEN ولا TELEGRAM_TOKEN في البيئة' } }
  if (!targetChat) { pushError('missing-chat', null); return { ok: false, error: 'لا يوجد TELEGRAM_ALERTS_CHAT_ID ولا DEVELOPER_ID في البيئة' } }

  const body = JSON.stringify({
    chat_id: targetChat,
    text: trimText(escapeHtml(text)),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })

  return await new Promise((resolve) => {
    let settled = false
    let req
    try {
      req = https.request(
        {
          hostname: 'api.telegram.org',
          port: 443,
          path: `/bot${token}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: Math.max(5000, Number(config.TELEGRAM_ALERTS_TIMEOUT_MS || 10000)),
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            if (settled) return
            settled = true
            try {
              const json = JSON.parse(data)
              if (json && json.ok) {
                resolve({ ok: true, statusCode: res.statusCode, data: json })
              } else {
                pushError('api-reject', { status: res.statusCode, body: json })
                resolve({ ok: false, statusCode: res.statusCode, data: json })
              }
            } catch (e) {
              pushError('parse-error', { status: res.statusCode, body: data.slice(0, 200) })
              resolve({ ok: false, statusCode: res.statusCode, error: 'parse_error' })
            }
          })
        }
      )
    } catch (e) {
      if (!settled) { settled = true; pushError('request-error', e.message); resolve({ ok: false, error: e.message }) }
      return
    }
    req.on('error', (e) => { if (!settled) { settled = true; pushError('socket-error', e.message); resolve({ ok: false, error: e.message }) } })
    req.on('timeout', () => { try { req.destroy(new Error('timeout')) } catch {} })
    try { req.write(body); req.end() } catch (e) { if (!settled) { settled = true; pushError('write-error', e.message); resolve({ ok: false, error: e.message }) } }
  })
}

/**
 * نفس الوظيفة لكن تستخدم النص بدون escape (للرسائل النصية الصرفة البسيطة).
 */
async function sendPlain(text, chatId = null) {
  const token = pickToken()
  const targetChat = String(chatId || pickChatId() || '').trim()
  if (!token || !targetChat) return { ok: false }
  const body = JSON.stringify({ chat_id: targetChat, text: trimText(text), disable_web_page_preview: true })
  return await new Promise((resolve) => {
    let settled = false
    const req = https.request({
      hostname: 'api.telegram.org', port: 443, path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: Math.max(5000, Number(config.TELEGRAM_ALERTS_TIMEOUT_MS || 10000)),
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { if (settled) return; settled = true; try { resolve({ ok: !!(JSON.parse(data).ok), body: data }) } catch { resolve({ ok: false }) } })
    })
    req.on('error', () => { if (!settled) { settled = true; resolve({ ok: false }) } })
    req.on('timeout', () => { try { req.destroy() } catch {} })
    req.write(body); req.end()
  })
}

module.exports = {
  sendAlert,
  sendPlain,
  getRecentErrors,
  pickToken,
  pickChatId,
}
