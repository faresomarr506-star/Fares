// lib/burn-local-sessions.js
// يضمن أن الجلسات في وضع قاعدة البيانات (SESSION_STORAGE_MODE=database)
// لا يبقى لها أي أثر محلي على القرص. الهدف: حتى لو أعدت النشر على بيئة
// جديدة بدون SESSIONS_DIR، تعود الجلسة من قاعدة البيانات كاملةً.

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const config = require('../config')

const PROTECTED_PREFIXES = ['_tmp_pair_']

function isProtected(name) {
  return PROTECTED_PREFIXES.some((p) => String(name || '').startsWith(p))
}

async function safeRm(target) {
  try { await fsp.rm(target, { recursive: true, force: true }) } catch {}
}

async function wipeDir(dir, { keepProtected = true } = {}) {
  const exists = await fsp.access(dir).then(() => true).catch(() => false)
  if (!exists) return { existed: false, removed: 0 }
  const entries = await fsp.readdir(dir).catch(() => [])
  let removed = 0
  for (const entry of entries) {
    if (keepProtected && isProtected(entry)) continue
    await safeRm(path.join(dir, entry))
    removed++
  }
  return { existed: true, removed }
}

async function purge() {
  if (String(config.SESSION_STORAGE_MODE || '').toLowerCase() !== 'database') {
    return { mode: config.SESSION_STORAGE_MODE, skipped: true }
  }
  const result = {
    mode: 'database',
    sessionsRemoved: 0,
    legacySessionsRemoved: 0,
    tmpPreserved: 0,
  }
  const root = String(config.SESSIONS_DIR || './sessions').replace(/\/+$/, '')
  const exists = await fsp.access(root).then(() => true).catch(() => false)
  if (!exists) return result
  const entries = await fsp.readdir(root).catch(() => [])
  for (const entry of entries) {
    if (isProtected(entry)) {
      result.tmpPreserved++
      continue
    }
    if (/^\d+_\d+$/.test(entry)) {
      await safeRm(path.join(root, entry))
      result.sessionsRemoved++
    } else if (/^\d+$/.test(entry)) {
      await safeRm(path.join(root, entry))
      result.legacySessionsRemoved++
    } else {
      await safeRm(path.join(root, entry))
    }
  }
  return result
}

module.exports = { purge, wipeDir }
