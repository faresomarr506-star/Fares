// monitor.js
// وحدة مراقبة الأرقام وإرسال تنبيهات تيليجرام
// تمييز حالتين:
//   - فصل (disconnected): socket أغلق أو loggedOut أو statusCode يتجاوز حد إعادة الاتصال
//   - توقف (stalled): الجلسة ظاهرياً متصلة لكن لا يستقبل/يرسل أي شيء منذ فترة طويلة
// الإرسال يخضع لـ debounce لمنع الإغراق عند انقطاع متكرر قصير
// عند الاستعادة تُرسل إشعار "تم الرجوع" ثم تُمسح العلامة حتى يَتم رصد دورة جديدة

const config = require('./config')
const telegram = require('./telegram')

const LOG_PREFIX = '[monitor]'
const states = new Map() // number(normalized) -> state

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60); const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60); const rm = m % 60
  return `${h}h ${rm}m`
}

function formatAgo(ts) {
  if (!ts) return '—'
  return formatMs(Date.now() - ts)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function ensure(number, userId, chatId) {
  const key = String(number || '').replace(/\D/g, '')
  let s = states.get(key)
  if (!s) {
    s = {
      key,
      number: String(number || key),
      userId: Number(userId) || null,
      chatId: Number(chatId) || null,
      firstSeenAt: Date.now(),
      lastHeartbeat: Date.now(),
      lastReaction: null,
      lastReactionOk: null,
      disconnectSince: null,
      lastDisconnectReason: null,
      reconnectAttempts: 0,
      lastStatusCode: null,
      alertSent: false,
      recoverySent: false,
      lastAlertAt: 0,
      lastRecoveryAt: 0,
    }
    states.set(key, s)
  } else {
    if (userId) s.userId = Number(userId) || s.userId
    if (chatId) s.chatId = Number(chatId) || s.chatId
    if (number) s.number = String(number)
  }
  return s
}

function feedConnect(number, userId, chatId, meta = {}) {
  const s = ensure(number, userId, chatId)
  s.lastHeartbeat = Date.now()
  if (!s.lastReaction) s.lastReaction = Date.now()
  s.disconnectSince = null
  s.lastDisconnectReason = null
  s.reconnectAttempts = 0
  s.lastStatusCode = null
  s.alertSent = false // reset so a new stall cycle re-alerts
}

function feedDisconnect(number, userId, chatId, statusCode = null, reason = '') {
  const s = ensure(number, userId, chatId)
  if (!s.disconnectSince) {
    s.disconnectSince = Date.now()
    s.lastDisconnectReason = { statusCode: statusCode ?? null, reason: String(reason || '').slice(0, 200) || null }
  }
  s.reconnectAttempts += 1
  s.lastStatusCode = statusCode ?? s.lastStatusCode
  if (!s.lastReaction) s.lastReaction = Date.now() - 1000
}

function feedHeartbeat(number, userId, chatId) {
  const s = ensure(number, userId, chatId)
  s.lastHeartbeat = Date.now()
}

function feedReaction(number, userId, chatId, ok = true) {
  const s = ensure(number, userId, chatId)
  s.lastReaction = Date.now()
  s.lastReactionOk = !!ok
  s.lastHeartbeat = Date.now()
}

function feedWatchdogForce(number, userId, chatId, reason = '') {
  const s = ensure(number, userId, chatId)
  s.lastForceRestart = { at: Date.now(), reason: String(reason || '').slice(0, 80) }
  s.lastHeartbeat = Date.now()
}

/**
 * التحقق الدوري من جميع الأرقام المسجَّلة — يستدعى من setInterval في index.js
 */
async function checkAll() {
  const now = Date.now()
  const stallThreshold = Number(config.ALERT_STALL_THRESHOLD_MS) || 180000
  const disconnectThreshold = Number(config.ALERT_DISCONNECT_THRESHOLD_MS) || 60000
  const cooldown = Number(config.ALERT_COOLDOWN_MS) || 120000

  for (const s of states.values()) {
    // 1) تنبيه الفصل: تمر أكثر من disconnectThreshold منذ بدء الانفصال
    if (s.disconnectSince && !s.alertSent) {
      const age = now - s.disconnectSince
      if (age >= disconnectThreshold) {
        s.alertSent = true
        s.lastAlertAt = now
        await sendDisconnectAlert(s, age).catch((e) => {
          console.warn(LOG_PREFIX, 'send disconnect alert failed:', e?.message || e)
        })
      }
      continue
    }

    // 2) تنبيه التوقف: لا نبض منذ stallThreshold مع غياب فصل (يعني ws ميت صامتاً)
    if (!s.disconnectSince && s.lastHeartbeat) {
      const idle = now - s.lastHeartbeat
      // تخطي الأرقام المسجَّلة حديثاً في أول دقيقتين حتى تستقر
      if ((now - (s.firstSeenAt || now)) < 120000) continue
      if (idle >= stallThreshold) {
        s.alertSent = true
        s.lastAlertAt = now
        await sendStallAlert(s, idle).catch((e) => {
          console.warn(LOG_PREFIX, 'send stall alert failed:', e?.message || e)
        })
      }
    }

    // 3) إشعار الاستعادة: الرقم عاد للنبض بعد أن أرسلنا تنبيهاً ولن يستقبل cooldown تبريد
    if (s.alertSent && !s.disconnectSince && s.lastHeartbeat && (now - s.lastHeartbeat < 8000)) {
      const sinceLastAlert = now - (s.lastAlertAt || 0)
      const sinceLastRecovery = now - (s.lastRecoveryAt || 0)
      if (sinceLastAlert >= 1000 && sinceLastRecovery >= cooldown) {
        s.recoverySent = true
        s.lastRecoveryAt = now
        try {
          await sendRecoveryAlert(s)
        } catch (e) {
          console.warn(LOG_PREFIX, 'send recovery alert failed:', e?.message || e)
        }
        // إعادة ضبط العلامات لقبول دورة تنبيهات جديدة لاحقاً
        s.alertSent = false
      }
    }
  }
}

async function sendDisconnectAlert(s, ageMs) {
  const code = s.lastDisconnectReason?.statusCode ?? s.lastStatusCode ?? 'unknown'
  const reason = s.lastDisconnectReason?.reason || ''
  const text =
    `🚨 <b>فصل جلسة واتساب</b>\n\n` +
    `📱 الرقم: <b>${escapeHtml(s.number)}</b>\n` +
    `🔌 السبب: <code>${escapeHtml(String(code))}</code>\n` +
    `⏱️ منذ: <b>${formatMs(ageMs)}</b>\n` +
    (reason ? `📝 ${escapeHtml(reason)}\n` : '') +
    `♻️ محاولات إعادة الاتصال: <b>${s.reconnectAttempts}</b>\n\n` +
    `⚙️ البوت يحاول إعادة الاتصال تلقائياً.\nسيصلك إشعار فور عودة الجلسة.`
  await telegram.sendAlert(text, s.chatId)
}

async function sendStallAlert(s, idleMs) {
  const text =
    `⚠️ <b>توقف جلسة واتساب</b>\n\n` +
    `📱 الرقم: <b>${escapeHtml(s.number)}</b>\n` +
    `🧊 لا استجابة منذ: <b>${formatMs(idleMs)}</b>\n\n` +
    `🔎 الجلسة في DB لا تزال "متصلة"، لكن الـ WebSocket لا يبث أحداثاً.\n` +
    `🛠 watchdog سيعيد تشغيل الجلسة تلقائياً خلال ثوانٍ.\nسيصلك إشعار فور عودة التفاعل.`
  await telegram.sendAlert(text, s.chatId)
}

async function sendRecoveryAlert(s) {
  const text =
    `✅ <b>تمت استعادة الجلسة</b>\n\n` +
    `📱 الرقم: <b>${escapeHtml(s.number)}</b>\n` +
    `⚡ التفاعل على الحالات يعمل من جديد.`
  await telegram.sendAlert(text, s.chatId)
}

let monitorInterval = null
function start() {
  if (monitorInterval) return
  const interval = Math.max(5000, Number(config.ALERT_MONITOR_INTERVAL_MS) || 30000)
  monitorInterval = setInterval(() => { checkAll().catch(() => {}) }, interval)
  // فحص فوري بعد نصف الفترة للتأكد من أن الأرقام الموجودة بالفعل تنتج تنبيهات عاجلة
  setTimeout(() => { checkAll().catch(() => {}) }, Math.min(interval, 15000))
  if (config.LOG_LEVEL === 'debug') console.log(LOG_PREFIX, `started (every ${interval}ms)`)
}

function stop() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
}

function getStates() {
  return Array.from(states.values()).sort((a, b) => a.key.localeCompare(b.key))
}

function getState(number) {
  const key = String(number || '').replace(/\D/g, '')
  return states.get(key) || null
}

function rebuild(allNumbers) {
  if (!Array.isArray(allNumbers)) return
  for (const n of allNumbers) ensure(n.number, n.userId, n.chatId)
}

module.exports = {
  start,
  stop,
  feedConnect,
  feedDisconnect,
  feedHeartbeat,
  feedReaction,
  feedWatchdogForce,
  checkAll,
  getStates,
  getState,
  rebuild,
}
