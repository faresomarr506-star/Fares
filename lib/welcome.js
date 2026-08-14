'use strict'

const { setWelcome, setGoodbye } = require('./index')

async function handleWelcome(sock, chatId, message, match) {
  const input = String(match || '').trim()
  const lowered = input.toLowerCase()
  if (!input) {
    await sock.sendMessage(chatId, { text: 'Usage: .welcome on | off | <custom text with {user} {group} {description}>' }, { quoted: message })
    return
  }
  if (lowered === 'on') {
    await setWelcome(chatId, true)
    await sock.sendMessage(chatId, { text: 'Welcome enabled.' }, { quoted: message })
    return
  }
  if (lowered === 'off') {
    await setWelcome(chatId, false)
    await sock.sendMessage(chatId, { text: 'Welcome disabled.' }, { quoted: message })
    return
  }
  await setWelcome(chatId, true, input)
  await sock.sendMessage(chatId, { text: 'Welcome message updated and enabled.' }, { quoted: message })
}

async function handleGoodbye(sock, chatId, message, match) {
  const input = String(match || '').trim()
  const lowered = input.toLowerCase()
  if (!input) {
    await sock.sendMessage(chatId, { text: 'Usage: .goodbye on | off | <custom text with {user} {group}>' }, { quoted: message })
    return
  }
  if (lowered === 'on') {
    await setGoodbye(chatId, true)
    await sock.sendMessage(chatId, { text: 'Goodbye enabled.' }, { quoted: message })
    return
  }
  if (lowered === 'off') {
    await setGoodbye(chatId, false)
    await sock.sendMessage(chatId, { text: 'Goodbye disabled.' }, { quoted: message })
    return
  }
  await setGoodbye(chatId, true, input)
  await sock.sendMessage(chatId, { text: 'Goodbye message updated and enabled.' }, { quoted: message })
}

module.exports = { handleWelcome, handleGoodbye }
