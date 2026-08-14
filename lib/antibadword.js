'use strict'

const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '..', 'data', 'antibadword.json')

function readState() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2))
}

async function handleAntiBadwordCommand(sock, chatId, message, match) {
  const args = String(match || '').trim().split(/\s+/).filter(Boolean)
  const state = readState()
  const current = state[chatId] || { enabled: false, words: ['badword'], action: 'delete' }
  const sub = String(args[0] || '').toLowerCase()

  if (!sub) {
    const text = [
      '*AntiBadword*',
      '.antibadword on',
      '.antibadword off',
      '.antibadword add كلمة',
      '.antibadword del كلمة',
      '.antibadword list',
    ].join('\n')
    await sock.sendMessage(chatId, { text }, { quoted: message })
    return
  }

  if (sub === 'on' || sub === 'off') {
    current.enabled = sub === 'on'
    state[chatId] = current
    writeState(state)
    await sock.sendMessage(chatId, { text: `AntiBadword ${current.enabled ? 'enabled' : 'disabled'}.` }, { quoted: message })
    return
  }

  if (sub === 'add') {
    const word = args.slice(1).join(' ').trim().toLowerCase()
    if (!word) return sock.sendMessage(chatId, { text: 'Usage: .antibadword add كلمة' }, { quoted: message })
    if (!current.words.includes(word)) current.words.push(word)
    state[chatId] = current
    writeState(state)
    await sock.sendMessage(chatId, { text: `Added: ${word}` }, { quoted: message })
    return
  }

  if (sub === 'del' || sub === 'remove') {
    const word = args.slice(1).join(' ').trim().toLowerCase()
    current.words = current.words.filter((item) => item !== word)
    state[chatId] = current
    writeState(state)
    await sock.sendMessage(chatId, { text: `Removed: ${word}` }, { quoted: message })
    return
  }

  if (sub === 'list') {
    await sock.sendMessage(chatId, { text: `Words: ${(current.words || []).join(', ') || '—'}` }, { quoted: message })
    return
  }

  await sock.sendMessage(chatId, { text: 'Unknown antibadword option.' }, { quoted: message })
}

module.exports = { handleAntiBadwordCommand }
