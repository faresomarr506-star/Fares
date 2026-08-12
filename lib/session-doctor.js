// lib/session-doctor.js
// فاحص طبي للجلسات عند الإقلاع وبعد ذلك دوريًا.
// مهمته:
//  1) ضمان أن الجلسة في واتساب تُعتبر "حيّة" ما دام اعتمادها محفوظًا في قاعدة البيانات
//     (cred + أي key مكتوبة خلال آخر HEALTH_WINDOW_MS) — حتى لو لم يصلها أي حدث.
//  2) تمييز الجلسات التالفة بسبب فقدان مزمن لـ app-state-sync-key ووسمها بدلاً من حذفها.
//  3) إعطاء تقرير سريع يُستخدم من /api/admin/sessions-health.

const config = require('../config')
const db = require('../db')
const { authSessionIdFor, legacyAuthSessionIdFor, normalizePhone } = require('../session-keys')

const HEALTH_WINDOW_MS = Math.max(60_000, Number(process.env.SESSION_HEALTH_WINDOW_MS || 1000 * 60 * 60 * 6))
const LAST_EVENT_LOOKBACK_MS = Math.max(60_000, Number(process.env.SESSION_LAST_EVENT_LOOKBACK_MS || 1000 * 60 * 60 * 24))

async function fetchAuthMeta(sessionId) {
  if (!db.isRemoteSessionStorageEnabled()) return null
  try {
    const docs = await db.authCollection
      .find(
        { sessionId: String(sessionId) },
        { projection: { file: 1, updatedAt: 1 } }
      )
      .limit(5000)
      .toArray()
    let credsAt = null
    let lastWrite = null
    let appStateKeys = 0
    let senderKeys = 0
    let preKeys = 0
    let identityKeys = 0
    for (const d of docs) {
      const t = d?.updatedAt ? new Date(d.updatedAt).getTime() : 0
      if (t && (!lastWrite || t > lastWrite)) lastWrite = t
      const f = String(d.file || '')
      if (f === 'creds.json') credsAt = t || credsAt
      else if (f.startsWith('app-state-sync-key-')) appStateKeys++
      else if (f.startsWith('sender-key-')) senderKeys++
      else if (f.startsWith('pre-key-')) preKeys++
      else if (f.startsWith('identity-key-')) identityKeys++
    }
    return { credsAt, lastWrite, appStateKeys, senderKeys, preKeys, identityKeys, fileCount: docs.length }
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

async function diagnoseOne(userId, number) {
  const sessionId = authSessionIdFor(userId, number)
  const legacyId = legacyAuthSessionIdFor(number)
  const meta = (await fetchAuthMeta(sessionId)) || (await fetchAuthMeta(legacyId))
  const out = {
    userId: Number(userId),
    number: normalizePhone(number),
    sessionId,
    legacySessionId: legacyId,
    hasCreds: !!meta?.credsAt,
    appStateKeyCount: meta?.appStateKeys || 0,
    senderKeyCount: meta?.senderKeys || 0,
    preKeyCount: meta?.preKeys || 0,
    identityKeyCount: meta?.identityKeys || 0,
    lastAuthWriteAt: meta?.lastWrite || null,
    ageMsSinceWrite: meta?.lastWrite ? Date.now() - meta.lastWrite : null,
    consideredAlive: false,
    notes: [],
  }
  if (!out.hasCreds) {
    out.notes.push('missing-creds')
    return out
  }
  const recent = out.lastAuthWriteAt && (Date.now() - out.lastAuthWriteAt) < HEALTH_WINDOW_MS
  const enoughAppState = out.appStateKeyCount >= 2
  const enoughPreKeys = out.preKeyCount >= 1
  out.consideredAlive = Boolean(recent || (enoughAppState && enoughPreKeys))
  if (!out.consideredAlive) {
    if (!recent) out.notes.push('no-recent-write')
    if (!enoughAppState) out.notes.push('few-app-state-keys')
    if (!enoughPreKeys) out.notes.push('few-pre-keys')
  }
  return out
}

async function runOnce() {
  if (!db.isMongoEnabled || !db.isMongoEnabled()) return { skipped: true }
  const all = db.getAllNumbers ? db.getAllNumbers() : []
  const report = { checked: 0, alive: 0, sick: 0, sickNumbers: [], at: Date.now() }
  for (const item of all) {
    try {
      const r = await diagnoseOne(item.userId, item.number)
      report.checked++
      if (r.consideredAlive) report.alive++
      else { report.sick++; report.sickNumbers.push({ number: r.number, notes: r.notes }) }
    } catch {}
  }
  return report
}

function start() {
  if (!db.isMongoEnabled || !db.isMongoEnabled()) return
  // فحص فوري بعد الإقلاع
  setTimeout(() => { runOnce().catch(() => {}) }, 5000)
  const interval = Math.max(60_000, Number(process.env.SESSION_DOCTOR_INTERVAL_MS || 1000 * 60 * 30))
  setInterval(() => { runOnce().catch(() => {}) }, interval)
}

module.exports = { start, runOnce, diagnoseOne }
