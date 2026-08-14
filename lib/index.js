'use strict'

const fs = require('fs')
const path = require('path')

const dataDir = path.join(__dirname, '..', 'data')
const stateFile = path.join(dataDir, 'king-saqr-state.json')

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function readState() {
  ensureDir()
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return {
      sudo: [],
      antilink: {},
      antitag: {},
      welcome: {},
      goodbye: {},
      banned: [],
    }
  }
}

function writeState(state) {
  ensureDir()
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  return state
}

function getMapEntry(bucket, key, fallback = null) {
  const state = readState()
  const map = state[bucket] || {}
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback
}

function setMapEntry(bucket, key, value) {
  const state = readState()
  if (!state[bucket] || typeof state[bucket] !== 'object' || Array.isArray(state[bucket])) state[bucket] = {}
  state[bucket][key] = value
  writeState(state)
  return value
}

function removeMapEntry(bucket, key) {
  const state = readState()
  if (state[bucket] && typeof state[bucket] === 'object') delete state[bucket][key]
  writeState(state)
  return true
}

async function addSudo(jid) {
  const state = readState()
  const value = String(jid || '').trim()
  if (!value) return false
  if (!state.sudo.includes(value)) state.sudo.push(value)
  writeState(state)
  return true
}

async function removeSudo(jid) {
  const state = readState()
  const value = String(jid || '').trim()
  state.sudo = state.sudo.filter((item) => item !== value)
  writeState(state)
  return true
}

async function getSudoList() {
  return readState().sudo || []
}

async function isSudo(jid) {
  const value = String(jid || '').trim()
  return (readState().sudo || []).includes(value)
}

async function setAntilink(chatId, enabled = 'on', action = 'delete') {
  return setMapEntry('antilink', String(chatId), { enabled: enabled !== 'off', action })
}

async function getAntilink(chatId) {
  return getMapEntry('antilink', String(chatId), null)
}

async function removeAntilink(chatId) {
  return removeMapEntry('antilink', String(chatId))
}

async function setAntitag(chatId, enabled = 'on', action = 'delete') {
  return setMapEntry('antitag', String(chatId), { enabled: enabled !== 'off', action })
}

async function getAntitag(chatId) {
  return getMapEntry('antitag', String(chatId), null)
}

async function removeAntitag(chatId) {
  return removeMapEntry('antitag', String(chatId))
}

async function setWelcome(chatId, enabled, message = '') {
  return setMapEntry('welcome', String(chatId), { enabled: enabled !== false, message: String(message || '') })
}

async function getWelcome(chatId) {
  return getMapEntry('welcome', String(chatId), {})?.message || ''
}

async function isWelcomeOn(chatId) {
  return !!getMapEntry('welcome', String(chatId), {})?.enabled
}

async function setGoodbye(chatId, enabled, message = '') {
  return setMapEntry('goodbye', String(chatId), { enabled: enabled !== false, message: String(message || '') })
}

async function getGoodbye(chatId) {
  return getMapEntry('goodbye', String(chatId), {})?.message || ''
}

async function isGoodByeOn(chatId) {
  return !!getMapEntry('goodbye', String(chatId), {})?.enabled
}

module.exports = {
  addSudo,
  removeSudo,
  getSudoList,
  isSudo,
  setAntilink,
  getAntilink,
  removeAntilink,
  setAntitag,
  getAntitag,
  removeAntitag,
  setWelcome,
  getWelcome,
  isWelcomeOn,
  setGoodbye,
  getGoodbye,
  isGoodByeOn,
}
