// settings.js (root stub)
// This file is required by several commands in commands/ (sticker.js,
// update.js, gif.js, etc.) that ship with the King Saqr command pack.
// We expose a minimal, Arabic-friendly default that matches the brand used
// throughout Fares Bot. The full bot identity (number, footer, channel link,
// owners) is taken from ./config so branding stays consistent.

'use strict'

const path = require('path')

let _config = null
try { _config = require('./config') } catch (_) { _config = {} }

module.exports = {
  // Backwards-compatible identifiers for the King Saqr command pack
  packname: 'King Saqr',
  author: 'Fares Bot',
  version: '1.0.0',
  botName: 'King Saqr — Fares Bot',
  footer: '🤖 Fares Bot — King Saqr Commands',
  channelLink: _config.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8jjfWCRs1sVz0x1w3v',
  channelInvite: _config.WHATSAPP_CHANNEL_INVITE || '0029Vb8jjfWCRs1sVz0x1w3v',
  ownerNumbers: [
    String(_config.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, ''),
    '994405946459',
  ],
  // Useful absolute path so commands that need to know the project root can
  // resolve it without relying on process.cwd() (Railway workers change cwd).
  projectRoot: path.resolve(__dirname),
}
