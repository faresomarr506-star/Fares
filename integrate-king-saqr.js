// integrate-king-saqr.js
// نقطة تركيب الأوامر العربية في كل دورة رسائل بمقبس WaSession.
// تم تحديث هذا الملف ليقوم بمعالجة كل رسالة واردة على الرقم المربوط
// (أي من أي محادثة/مجموعة/DM) وتمريرها إلى king-saqr/dispatcher.js حتى
// تعمل جميع الأوامر العربية داخل الرقم نفسه، وليس فقط رسائل المالك.
//
// يحافظ على المُحلِّل الحالي handleOwnerTextCommand الخاص بالمالك
// دون تداخل: يتم تنفيذ dispatcher أولاً، فإذا لم يتعرّف على الأمر
// يواصل whatsapp.js معالجة أوامر المالك والتنزيلات والصلاحيات.

'use strict'

const path = require('path')

let _dispatcher = null
function getDispatcher() {
  if (!_dispatcher) {
    _dispatcher = require(path.join(__dirname, 'king-saqr', 'dispatcher.js'))
  }
  return _dispatcher
}

function _setDestination(sock, userId, number) {
  try { sock.__kingSaqrUserId = userId } catch {}
  try { sock.__kingSaqrNumber = number } catch {}
}

function _shouldSkip(msg) {
  if (!msg || !msg.message) return true
  const remoteJid = String(msg?.key?.remoteJid || '')
  // تجاهل رسائل الحالات (الستوري) — لها مسار معالجة خاص بها
  if (remoteJid === 'status@broadcast') return true
  // تجاهل رسائل البوت نفسه
  if (msg?.key?.fromMe) return true
  // لا نعالج إلا الرسائل النصية (extended/conversation/captions)
  const inner = msg.message
  const hasText = !!(
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.documentMessage?.caption
  )
  if (!hasText) return true
  return false
}

/**
 * تركيب dispatcher على مقبس جلسة واتساب.
 * يجب استدعاؤها مرة واحدة لكل WaSession بعد إنشاء sock.
 */
async function mountKingSaqr(sock, ctx = {}) {
  if (!sock) return sock
  if (sock.__kingSaqrMounted) return sock
  sock.__kingSaqrMounted = true

  if (ctx?.userId) sock.__kingSaqrUserId = ctx.userId
  if (ctx?.number) sock.__kingSaqrNumber = ctx.number

  // تخزين identity لتستخدمها مجموعات الرسائل اللاحقة
  sock.__kingSaqrSetDestination = (userId, number) => _setDestination(sock, userId, number)

  // معالجة فورية للرسائل المخزّنة — تُستخدم عند تشغيل الجلسة لأول مرة
  sock.__kingSaqrHandleNow = async (messages) => {
    return handleMessages(sock, Array.isArray(messages) ? messages : [messages])
  }

  return sock
}

/**
 * معالجة مجموعة رسائل واردة على sock.
 * تستخرج النص، فتُمرّر كل رسالة تبدأ بالبادئة (./!/#) إلى dispatcher.
 * ترجع true إذا تم تشغيل أمر ما، وإلا false لتكملة whatsapp.js مساره.
 */
async function handleMessages(sock, messages) {
  try {
    const dispatcher = getDispatcher()
    const list = Array.isArray(messages) ? messages : [messages]
    let handled = false
    for (const m of list) {
      if (_shouldSkip(m)) continue
      if (!sock.__kingSaqrHandled) sock.__kingSaqrHandled = new Set()
      if (m?.key?.id && sock.__kingSaqrHandled.has(m.key.id)) continue
      const text = (
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        m.message?.documentMessage?.caption ||
        ''
      ).trim()
      if (!text) continue
      // تشغّل فقط الرسائل التي تبدأ بأحد البادئات؛ أي رسالة لا تبدأ بها
      // تترك لـ whatsapp.js للاستفادة من معالجة other paths (downloads/owner)
      if (!/^[.\/!#]/.test(text)) continue
      const remoteJid = m.key?.remoteJid
      const senderId = m.key?.participant || m.key?.remoteJid
      try {
        const result = await dispatcher.dispatchMessage(sock, remoteJid, m, senderId, {})
        if (result) {
          handled = true
          if (m?.key?.id) sock.__kingSaqrHandled.add(m.key.id)
        }
      } catch (e) {
        console.error('[king-saqr dispatch]', e?.message || e)
      }
    }
    return handled
  } catch (e) {
    console.error('[king-saqr mount]', e?.message || e)
    return false
  }
}

module.exports = {
  mountKingSaqr,
  handleMessages,
}
