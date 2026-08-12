// lib/session-doctor.js
// فاحص طبي للجلسات عند الإقلاع وبعد ذلك دوريًا.
// يعتمد بالكامل على MongoDB عند تفعيل SESSION_STORAGE_MODE=database
// للتأكد أن الجلسات قابلة للاستعادة وأن مفاتيحها الأساسية موجودة.

const db = require('../db')
const { authSessionIdFor, legacyAuthSessionIdFor, normalizePhone } = require('./session-keys')

const HEALTH_WINDOW_MS = Math.max(60_000, Number(process.env.SESSION_HEALTH_WINDOW_MS || 1000 * 60 * 60 * 6))

function getAuthCollection() {
  try {
    return typeof db.getAuthCollection === 'function' ? db.getAuthCollection() : null
  } catch {
    return null
  }
}

async function fetchAuthMeta(sessionId) {
  const authCollection = getAuthCollection()
  if (!authCollection) return null
  try {
    const docs = await authCollection
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
      const f = String(d?.file || '')
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
  let meta = await fetchAuthMeta(sessionId)
  if (!meta?.credsAt) {
    const legacyMeta = await fetchAuthMeta(legacyId)
    if (legacyMeta?.credsAt) meta = legacyMeta
  }

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
      else {
        report.sick++
        report.sickNumbers.push({ number: r.number, notes: r.notes })
      }
    } catch {}
  }

  return report
}

let timer = null

function start() {
  if (!db.isMongoEnabled || !db.isMongoEnabled()) return
  if (timer) return
  setTimeout(() => { runOnce().catch(() => {}) }, 5000)
  const interval = Math.max(60_000, Number(process.env.SESSION_DOCTOR_INTERVAL_MS || 1000 * 60 * 30))
  timer = setInterval(() => { runOnce().catch(() => {}) }, interval)
}

function stop() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

module.exports = { start, stop, runOnce, diagnoseOne }
