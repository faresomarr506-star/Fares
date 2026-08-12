// lib/session-keys.js — أدوات مساعدة مشتركة بين الوحدات لتوليد معرّفات الجلسات
// منعاً لاختلافها بين whatsapp.js و session-doctor.js
const path = require('path')

const normalizePhone = (number) => String(number || '').replace(/\D/g, '')
const sessionIdentity = (userId, number) => `${Number(userId)}_${normalizePhone(number)}`
const authSessionIdFor = (userId, number) => `wa_session_${sessionIdentity(userId, number)}`
const legacyAuthSessionIdFor = (number) => `wa_session_${normalizePhone(number)}`
const authFolderFor = (userId, number) => path.join(process.env.SESSIONS_DIR || './sessions', sessionIdentity(userId, number))
const legacyAuthFolderFor = (number) => path.join(process.env.SESSIONS_DIR || './sessions', normalizePhone(number))

module.exports = {
  normalizePhone,
  sessionIdentity,
  authSessionIdFor,
  legacyAuthSessionIdFor,
  authFolderFor,
  legacyAuthFolderFor,
}
