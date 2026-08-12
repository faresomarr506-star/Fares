// lib/session-manager.js
// مدير مركزي يربط جميع جلسات WhatsApp بقاعدة بيانات المشروع.
// يقوم بـ:
//   1) ضمان بقاء إعدادات التفاعل لكل رقم في قاعدة البيانات دون تعديل.
//   2) مزامنة لقطعة ملفات الجلسة من القرص إلى القاعدة بشكل آمن عند كل تغيير.
//   3) تحديث الجلسة نفسها بشكل دوري بحيث تعود "نظيفة كما لو تم ربطها للتو"،
//      مع الحفاظ الكامل على إعدادات التفاعل والايموجي في app_state.
//   4) تنظيف أي ملفات مؤقتة (_tmp_pair_*, app-state-sync-versions/*, كاش الذاكرة)
//      بعد كل تحديث حتى تستمر جميع الأرقام في العمل داخل WhatsApp بدون مشاكل.
//
// لماذا لا نقوم بالتحديث كل ثانية؟
//   لأن ذلك يرفضه واتساب (rate-limit) ويخرج الأرقام من واتساب فوراً.
//   الحل: استجابة فورية keyboard لكل تغيير من Baileys (موجودة في whatsapp.js keys.set)
//   + تحديث آمن دوري (افتراضياً كل 60 دقيقة) لإعادة تدوير الجلسة بنظافة.

const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const config = require('../config')
const db = require('../db')
const sessionKeys = require('./session-keys')

const AUTH_FILE_PREFIXES_TO_KEEP = [
  'creds.json',
  'app-state-sync-key-',
  'pre-key-',
  'identity-key-',
  'sender-key-',
]

const AUTH_FILE_PREFIXES_TO_PRUNE = [
  'app-state-sync-version-',
  'app-state-sync-versions-',
  'libsignal_',
]

const TMP_SESSION_PREFIX = '_tmp_pair_'

let timer = null
let running = false
let consecutiveFailures = 0
let startedAt = 0
let lastRunAt = 0
let lastReport = null

function logDebug(...args) { console.log('[session-manager]', ...args) }
function logWarn(...args) { console.warn('[session-manager]', ...args) }
function logError(...args) { console.error('[session-manager]', ...args) }

function safeNumber(raw) { return String(raw || '').replace(/\D/g, '') }
function safeUserId(raw) { const n = Number(raw); return Number.isFinite(n) ? n : 0 }
function authFolderFor(userId, number) { return sessionKeys.authFolderFor(userId, number) }

// 1) ضمان بقاء إعدادات الرقم في القاعدة دون حذف ولا تعديل للقيم.
async function ensureNumberPersistedInDb(userId, number) {
  try {
    const userIdN = safeUserId(userId)
    const numberN = safeNumber(number)
    if (!userIdN || !numberN) return
    const existing = db.getNumber ? db.getNumber(userIdN, numberN) : null
    if (!existing) return
    if (!existing.settings || typeof existing.settings !== 'object' || !Object.keys(existing.settings).length) {
      try { db.setPhoneSettings(userIdN, numberN, {}) } catch (_) {}
    }
  } catch (e) {
    logWarn('ensureNumberPersistedInDb:', e?.message || e)
  }
}

// 2) مزامنة لقطعة ملفات الجلسة من القرص إلى القاعدة.
//    نحتفظ فقط بـ creds.json + app-state-sync-key-* + pre-key-* + identity-key-* + sender-key-*
//    نحذف كل شيء آخر (كاش مؤقت، إصدارات قديمة من app-state-sync-versions).
async function writeAuthFolderSnapshotToDb(userId, number) {
  try {
    if (!db.isRemoteSessionStorageEnabled || !db.isRemoteSessionStorageEnabled()) return false
    const folder = authFolderFor(userId, number)
    const exists = await fsp.access(folder).then(() => true).catch(() => false)
    if (!exists) return false
    const sessionId = sessionKeys.authSessionIdFor(userId, number)
    const mutations = []
    const entries = await fsp.readdir(folder).catch(() => [])
    let prunedFiles = 0
    for (const file of entries) {
      const isPrune = AUTH_FILE_PREFIXES_TO_PRUNE.some((p) => file.startsWith(p) || file === p.slice(0, -1).replace(/-$/, ''))
      if (isPrune) {
        try { await fsp.rm(path.join(folder, file), { force: true }); prunedFiles++ } catch (_) {}
        continue
      }
      const keepable = AUTH_FILE_PREFIXES_TO_KEEP.some((p) => file === p || file.startsWith(p))
      if (!keepable) {
        try { await fsp.rm(path.join(folder, file), { force: true }); prunedFiles++ } catch (_) {}
        continue
      }
      try {
        const raw = await fsp.readFile(path.join(folder, file), 'utf8')
        if (!raw) continue
        mutations.push({ fileName: file, value: JSON.parse(raw) })
      } catch (_) {}
    }
    if (mutations.length && typeof db.applyWaAuthMutations === 'function') {
      await db.applyWaAuthMutations(sessionId, mutations)
      return { sessionId, files: mutations.length, pruned: prunedFiles }
    }
    return { sessionId, files: 0, pruned: prunedFiles }
  } catch (e) {
    logError('writeAuthFolderSnapshotToDb:', e?.message || e)
    return false
  }
}

// 3) تنظيف مجلد tmp الخاص بطلب كود الاقتران بعد كل ربط.
async function purgePairingTmpFolders() {
  try {
    const dir = config.SESSIONS_DIR || './sessions'
    const exists = await fsp.access(dir).then(() => true).catch(() => false)
    if (!exists) return 0
    const entries = await fsp.readdir(dir).catch(() => [])
    let removed = 0
    for (const entry of entries) {
      if (entry.startsWith(TMP_SESSION_PREFIX)) {
        try {
          await fsp.rm(path.join(dir, entry), { recursive: true, force: true })
          removed++
        } catch (_) {}
      }
    }
    return removed
  } catch (e) {
    logWarn('purgePairingTmpFolders:', e?.message || e)
    return 0
  }
}

// 4) تنظيف كاش الذاكرة داخل كل WaSession ليستمر التفاعل بسلاسة.
async function refreshInMemoryCaches(getSessionFn) {
  let cleared = 0
  try {
    const all = typeof getSessionFn === 'function' ? getSessionFn() : []
    for (const s of all) {
      if (!s) continue
      try {
        if (s.deletedStatusArchive && typeof s.deletedStatusArchive.clear === 'function') {
          s.deletedStatusArchive.clear(); cleared++
        }
        if (s.deletedMessagesArchive && typeof s.deletedMessagesArchive.clear === 'function') {
          s.deletedMessagesArchive.clear(); cleared++
        }
        if (s.contactProfileCache && typeof s.contactProfileCache === 'object' && s.contactProfileCache.size > 50) {
          const excess = s.contactProfileCache.size - 50
          const keys = Array.from(s.contactProfileCache.keys()).slice(0, excess)
          for (const k of keys) s.contactProfileCache.delete(k)
          cleared += keys.length
        }
      } catch (_) {}
    }
  } catch (e) {
    logWarn('refreshInMemoryCaches:', e?.message || e)
  }
  return cleared
}

// 5) تحديث الجلسة: إغلاق → إعادة اعتماد نظيفة من القاعدة → إعادة فتح.
//    الإعدادات (الموجودة في app_state) تبقى كما هي 100%.
async function rotateSessionClean(userId, number) {
  try {
    const userIdN = safeUserId(userId)
    const numberN = safeNumber(number)
    if (!userIdN || !numberN) return { ok: false, reason: 'invalid' }
    const whatsapp = require('../whatsapp')
    if (!whatsapp || typeof whatsapp.stopSession !== 'function' || typeof whatsapp.startSession !== 'function') {
      return { ok: false, reason: 'no-whatsapp' }
    }

    // التقاط الإعدادات الحالية قبل الإغلاق لاحترامها
    let preservedSettings = null
    try {
      const current = db.getNumber ? db.getNumber(userIdN, numberN) : null
      preservedSettings = current?.settings || null
    } catch (_) {}

    // إغلاق المقبس محلياً دون تسجيل خروج من واتساب (الـ false تمنع logout)
    try { await whatsapp.stopSession(userIdN, numberN, false) } catch (e) {
      logWarn('rotateSessionClean stopSession:', e?.message || e)
    }

    // تنظيف ملفات الكاش في القرص
    try {
      const folder = authFolderFor(userIdN, numberN)
      if (await fsp.access(folder).then(() => true).catch(() => false)) {
        const entries = await fsp.readdir(folder).catch(() => [])
        for (const file of entries) {
          if (AUTH_FILE_PREFIXES_TO_PRUNE.some((p) => file.startsWith(p))) {
            try { await fsp.rm(path.join(folder, file), { force: true }) } catch (_) {}
          }
        }
      }
    } catch (e) { logWarn('rotateSessionClean prune:', e?.message || e) }

    // إعادة كتابة الإعدادات كما كانت قبل إعادة الفتح
    if (preservedSettings && db.setPhoneSettings) {
      try { db.setPhoneSettings(userIdN, numberN, preservedSettings) } catch (_) {}
    }

    // إعادة فتح الجلسة من بيانات الاعتماد في القاعدة
    try {
      await whatsapp.startSession(userIdN, numberN, null, { isNewPairing: false })
    } catch (e) { logWarn('rotateSessionClean startSession:', e?.message || e) }

    return { ok: true, reason: 'restarted' }
  } catch (e) {
    logError('rotateSessionClean:', e?.message || e)
    return { ok: false, reason: e?.message || String(e) }
  }
}

// جولة كاملة: مزامنة + تنظيف + تحديث كل الأرقام.
async function runOnce() {
  if (running) return { skipped: true }
  running = true
  const startTs = Date.now()
  let numbersScanned = 0
  let numbersSnapped = 0
  let numbersRotated = 0
  let tmpFoldersRemoved = 0
  let cacheEntriesCleared = 0
  let totalFilesPruned = 0
  try {
    const allNumbers = typeof db.getAllNumbers === 'function' ? db.getAllNumbers() : []
    for (const item of allNumbers) {
      try {
        await ensureNumberPersistedInDb(item.userId, item.number)
        numbersScanned++
      } catch (_) {}
    }

    for (const item of allNumbers) {
      try {
        const r = await writeAuthFolderSnapshotToDb(item.userId, item.number)
        if (r && r.files) numbersSnapped++
        if (r && r.pruned) totalFilesPruned += r.pruned
      } catch (_) {}
    }

    tmpFoldersRemoved = await purgePairingTmpFolders()

    let whatsapp = null
    try { whatsapp = require('../whatsapp') } catch (_) { whatsapp = null }
    if (whatsapp && typeof whatsapp.listSessionSnapshots === 'function') {
      cacheEntriesCleared = await refreshInMemoryCaches(whatsapp.listSessionSnapshots)
    }

    const now = Date.now()
    const interval = Math.max(60_000, Number(config.SESSION_REFRESH_INTERVAL_MS || 1000 * 60 * 60))
    if (!lastRunAt || (now - lastRunAt) >= interval) {
      let active = []
      try { if (whatsapp && typeof whatsapp.listSessionSnapshots === 'function') active = whatsapp.listSessionSnapshots() } catch (_) {}
      const concurrency = Math.max(1, Number(config.RESUME_CONCURRENCY || 6))
      for (let i = 0; i < active.length; i += concurrency) {
        const slice = active.slice(i, i + concurrency)
        await Promise.allSettled(slice.map(async (snap) => {
          try {
            const r = await rotateSessionClean(snap.userId, snap.number)
            if (r && r.ok) numbersRotated++
          } catch (_) {}
        }))
        if (config.RESUME_BATCH_DELAY_MS) {
          await new Promise((res) => setTimeout(res, Number(config.RESUME_BATCH_DELAY_MS) || 250))
        }
      }
      lastRunAt = now
    }

    lastReport = {
      scanned: numbersScanned,
      snapshotted: numbersSnapped,
      rotated: numbersRotated,
      tmpFoldersRemoved,
      cacheEntriesCleared,
      filesPrunedOnDisk: totalFilesPruned,
      durationMs: Date.now() - startTs,
      at: new Date().toISOString(),
    }
    consecutiveFailures = 0
    logDebug('cycle ok', lastReport)
    return lastReport
  } catch (e) {
    consecutiveFailures++
    logError('runOnce:', e?.message || e)
    return { error: e?.message || String(e) }
  } finally {
    running = false
  }
}

function start() {
  if (timer) return { started: true, note: 'already-running' }
  startedAt = Date.now()
  const cycle = Math.max(10_000, Number(config.SESSION_MANAGER_CYCLE_MS || 1000 * 30))
  setTimeout(() => { runOnce().catch(() => {}) }, 5000)
  timer = setInterval(() => { runOnce().catch(() => {}) }, cycle)
  logDebug(`manager started, cycle=${cycle}ms`)
  return { started: true, cycle }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; return { stopped: true } }
  return { stopped: false }
}

function stats() {
  return { startedAt, lastRunAt, lastReport, failures: consecutiveFailures, running }
}

module.exports = { start, stop, runOnce, stats }
