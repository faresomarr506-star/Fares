'use strict'

const settings = require('../settings')
const { isSudo } = require('./index')

function normalize(value) {
  const raw = String(value || '').trim()
  const num = raw.split('@')[0].split(':')[0].replace(/\D/g, '')
  return { raw, num }
}

async function isOwnerOrSudo(senderId, sock, chatId) {
  const sender = normalize(senderId)
  if (!sender.raw && !sender.num) return false
  const ownerNumbers = Array.isArray(settings.ownerNumbers)
    ? settings.ownerNumbers.map((v) => String(v).replace(/\D/g, ''))
    : [String(settings.ownerNumber || '').replace(/\D/g, '')]
  const botMe = normalize(sock?.user?.id)
  if (sender.raw === botMe.raw || (sender.num && sender.num === botMe.num)) return true
  if (ownerNumbers.includes(sender.num)) return true
  return !!(await isSudo(sender.raw)) || !!(sender.num && await isSudo(`${sender.num}@s.whatsapp.net`))
}

module.exports = isOwnerOrSudo
