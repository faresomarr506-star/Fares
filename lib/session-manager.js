// lib/session-manager.js
// مدير مركزي خفيف للجلسات:
// - يضمن بقاء إعدادات كل رقم محفوظة في قاعدة البيانات.
// - يهاجر أي ملفات اعتماد محلية متبقية إلى MongoDB عند الحاجة.
// - ينظف المجلدات المؤقتة.
// - يعيد تشغيل الجلسات غير الصحية فقط بدلاً من تدوير جميع الجلسات دورياً.

const fs = require('fs')
const path = require('path')
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
let lastRotateSweepAt = 0
let lastReport = null

function logDebug(...args) { if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'info') console.log('[session-manager]', ...args) }
function logWarn(...args) { console.warn('[session-manager]', ...args) }
function logError(...args) { console.error('[session-manager]', ...args) }

function safeNumber(raw) { return String(raw || '').replace(/\D/g, '') }
function safeUserId(raw) { const n = Number(raw); return Number.isFinite(n) ? n : 0 }
function authFolderFor(userId, number) { return sessionKeys.authFolderFor(userId, number) }

function useDatabaseOnlySessionStorage() {
  return String(config.SESSION_STORAGE_MODE || '').toLowerCase() === 'database' && db.isRemoteSessionStorageEnabled && db.isRemoteSessionStorageEnabled()
}

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

async function purgePairingTmpFolders() {
  try {
    const dir = config.SESSIONS_DIR || './sessions'
    const exists = await fsp.access(dir).then(() => true).catch(() => false)
    if (!exists) return 0
    const entries = await fsp.readdir(dir).catch(() => [])
    let removed = 0
    for (const entry of entries) {
      if (!entry.startsWith(TMP_SESSION_PREFIX)) continue
      try {
        await fsp.rm(path.join(dir, entry), { recursive: true, force: true })
        removed++
      } catch (_) {}
    }
    return removed
  } catch (e) {
    logWarn('purgePairingTmpFolders:', e?.message || e)
    return 0
  }
}

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

function shouldRotateSnapshot(snap) {
  if (!snap) return false
  const now = Date.now()
  const healthTimeout = Math.max(30_000, Number(config.SESSION_HEALTH_TIMEOUT_MS || 120_000))
  const dbStatus = String(snap.dbStatus || '')

  if (snap.sockReady === false && dbStatus === 'connected') return true
  if (snap.closed === true && dbStatus === 'connected') return true
  if (snap.pendingReactions > 0 && snap.lastSocketPong && (now - Number(snap.lastSocketPong)) > healthTimeout) return true
  if (snap.lastHeartbeat && (now - Number(snap.lastHeartbeat)) > healthTimeout * 3) return true
  return false
}

async function rotateSessionClean(userId, number) {
  try {
    const userIdN = safeUserId(userId)
    const numberN = safeNumber(number)
    if (!userIdN || !numberN) return { ok: false, reason: 'invalid' }
    const whatsapp = require('../whatsapp')
    if (!whatsapp || typeof whatsapp.stopSession !== 'function' || typeof whatsapp.startSession !== 'function') {
      return { ok: false, reason: 'no-whatsapp' }
    }

    let preservedSettings = null
    try {
      const current = db.getNumber ? db.getNumber(userIdN, numberN) : null
      preservedSettings = current?.settings || null
    } catch (_) {}

    try { await whatsapp.stopSession(userIdN, numberN, false) } catch (e) {
      logWarn('rotateSessionClean stopSession:', e?.message || e)
    }

    if (preservedSettings && db.setPhoneSettings) {
      try { db.setPhoneSettings(userIdN, numberN, preservedSettings) } catch (_) {}
    }

    await whatsapp.startSession(userIdN, numberN, null, { isNewPairing: false, resumed: true })
    return { ok: true, reason: 'restarted' }
  } catch (e) {
    logError('rotateSessionClean:', e?.message || e)
    return { ok: false, reason: e?.message || String(e) }
  }
}

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

    if (!useDatabaseOnlySessionStorage()) {
      for (const item of allNumbers) {
        try {
          const r = await writeAuthFolderSnapshotToDb(item.userId, item.number)
          if (r && r.files) numbersSnapped++
          if (r && r.pruned) totalFilesPruned += r.pruned
        } catch (_) {}
      }
    }

    tmpFoldersRemoved = await purgePairingTmpFolders()

    let whatsapp = null
    try { whatsapp = require('../whatsapp') } catch (_) { whatsapp = null }
    let active = []
    if (whatsapp && typeof whatsapp.listSessionSnapshots === 'function') {
      active = whatsapp.listSessionSnapshots()
      cacheEntriesCleared = await refreshInMemoryCaches(() => active)
    }

    const now = Date.now()
    const rotateInterval = Math.max(60_000, Number(config.SESSION_REFRESH_INTERVAL_MS || 1000 * 60 * 60))
    const rotateSweepDue = config.SESSION_AUTO_ROTATE_ENABLED === true && (!lastRotateSweepAt || (now - lastRotateSweepAt) >= rotateInterval)

    const candidates = active.filter((snap) => shouldRotateSnapshot(snap) || rotateSweepDue)
    if (candidates.length) {
      const concurrency = Math.max(1, Math.min(Number(config.RESUME_CONCURRENCY || 6), 8))
      for (let i = 0; i < candidates.length; i += concurrency) {
        const slice = candidates.slice(i, i + concurrency)
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
    }

    if (rotateSweepDue) lastRotateSweepAt = now
    lastRunAt = now
    lastReport = {
      scanned: numbersScanned,
      snapshotted: numbersSnapped,
      rotated: numbersRotated,
      tmpFoldersRemoved,
      cacheEntriesCleared,
      filesPrunedOnDisk: totalFilesPruned,
      dbOnlyMode: useDatabaseOnlySessionStorage(),
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
  if (timer) {
    clearInterval(timer)
    timer = null
    return { stopped: true }
  }
  return { stopped: false }
}

function stats() {
  return { startedAt, lastRunAt, lastRotateSweepAt, lastReport, failures: consecutiveFailures, running }
}

module.exports = { start, stop, runOnce, stats }
