'use strict'

function cleanJid(value) {
  return String(value || '').trim()
}

async function isAdmin(sock, chatId, senderId) {
  const result = { isSenderAdmin: false, isBotAdmin: false, participants: [], metadata: null }
  try {
    if (!chatId || !String(chatId).endsWith('@g.us')) return result
    const metadata = await sock.groupMetadata(chatId)
    const participants = Array.isArray(metadata?.participants) ? metadata.participants : []
    result.metadata = metadata
    result.participants = participants

    const sender = cleanJid(senderId)
    const botId = cleanJid(sock?.user?.id).split(':')[0]
    const botCandidates = new Set([
      cleanJid(sock?.user?.id),
      botId ? `${botId}@s.whatsapp.net` : '',
      botId ? `${botId}@lid` : '',
    ].filter(Boolean))

    for (const participant of participants) {
      const jid = cleanJid(participant?.id)
      const isAdminRole = participant?.admin === 'admin' || participant?.admin === 'superadmin'
      if (jid === sender && isAdminRole) result.isSenderAdmin = true
      if (botCandidates.has(jid) && isAdminRole) result.isBotAdmin = true
    }
    return result
  } catch {
    return result
  }
}

module.exports = isAdmin
