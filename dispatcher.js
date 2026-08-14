'use strict'

const path = require('path')
const fs = require('fs')
const store = require('./lib/lightweight_store')
const isAdmin = require('./lib/isAdmin')
const isOwnerOrSudo = require('./lib/isOwner')

const mentionModule = lazy(() => require('./commands/mention'))
const chatbotModule = lazy(() => require('./commands/chatbot'))
const topMembersModule = lazy(() => require('./commands/topmembers'))
const tttModule = lazy(() => require('./commands/tictactoe'))
const welcomeModule = lazy(() => require('./commands/welcome'))
const goodbyeModule = lazy(() => require('./commands/goodbye'))

function lazy(factory) {
  let cached = null
  return () => {
    if (!cached) cached = factory()
    return cached
  }
}

function extractText(message) {
  return String(
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    message?.message?.documentMessage?.caption ||
    ''
  ).trim()
}

const PREFIXES = ['.', '!', '/', '#']
function parseCommand(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed || !PREFIXES.includes(trimmed[0])) return null
  const body = trimmed.slice(1).trim()
  const parts = body.split(/\s+/)
  const raw = (parts.shift() || '').trim()
  return {
    raw,
    name: raw.toLowerCase(),
    args: parts,
    rest: parts.join(' ').trim(),
    text: trimmed,
    prefix: trimmed[0],
  }
}

const ALIASES = {
  الاوامر: 'help', أوامر: 'help', commands: 'help', menu: 'help', help: 'help',
  بنج: 'ping', ping: 'ping', حي: 'alive', alive: 'alive',
  المالك: 'owner', owner: 'owner',
  نكتة: 'joke', joke: 'joke', اقتباس: 'quote', quote: 'quote', معلومة: 'fact', fact: 'fact',
  طقس: 'weather', weather: 'weather', أخبار: 'news', news: 'news', كلمات: 'lyrics', lyrics: 'lyrics',
  تكلم: 'tts', tts: 'tts', ترجمة: 'translate', translate: 'translate', صورة_موقع: 'ss', ss: 'ss',
  رابط: 'url', url: 'url', معلومات_القروب: 'groupinfo', groupinfo: 'groupinfo', المشرفين: 'staff', staff: 'staff',
  منشن_الكل: 'tagall', tagall: 'tagall', منشن_الأعضاء: 'tagnotadmin', tagnotadmin: 'tagnotadmin',
  منشن_مخفي: 'hidetag', hidetag: 'hidetag', طرد: 'kick', kick: 'kick', تحذير: 'warn', warn: 'warn', تحذيرات: 'warnings', warnings: 'warnings',
  كتم: 'mute', mute: 'mute', فك_الكتم: 'unmute', unmute: 'unmute', حذف: 'delete', del: 'delete', delete: 'delete',
  ترقية: 'promote', promote: 'promote', تنزيل: 'demote', demote: 'demote', إعادة_الرابط: 'resetlink', resetlink: 'resetlink',
  ترحيب: 'welcome', welcome: 'welcome', وداع: 'goodbye', goodbye: 'goodbye',
  اسم_القروب: 'setgname', setgname: 'setgname', وصف_القروب: 'setgdesc', setgdesc: 'setgdesc', صورة_القروب: 'setgpp', setgpp: 'setgpp',
  حظر: 'ban', ban: 'ban', فك_الحظر: 'unban', unban: 'unban', سودو: 'sudo', sudo: 'sudo',
  ملصق: 'sticker', sticker: 'sticker', صورة_الملصق: 'simage', simage: 'simage', قص: 'stickercrop', crop: 'stickercrop',
  شفاف: 'removebg', removebg: 'removebg', تحسين: 'remini', remini: 'remini', تمويه: 'img-blur', blur: 'img-blur',
  ميم: 'meme', meme: 'meme', أخذ: 'take', take: 'take', دمج_إيموجي: 'emojimix', emojimix: 'emojimix',
  ملصقات_تيليجرام: 'stickertelegram', tg: 'stickertelegram', stickertelegram: 'stickertelegram',
  صراحة: 'truth', truth: 'truth', تحدي: 'dare', dare: 'dare', شنق: 'hangman', hangman: 'hangman',
  اكس_او: 'tictactoe', ttt: 'tictactoe', tictactoe: 'tictactoe', سؤال: 'trivia', trivia: 'trivia',
  ذكاء: 'ai', ai: 'ai', gemini: 'ai', gpt: 'ai', تخيل: 'imagine', imagine: 'imagine', سورا: 'sora', sora: 'sora',
  شغل: 'play', play: 'play', أغنية: 'song', song: 'song', سبوتيفاي: 'spotify', spotify: 'spotify',
  انستا: 'instagram', إنستا: 'instagram', instagram: 'instagram', فيسبوك: 'facebook', facebook: 'facebook', تيك_توك: 'tiktok', tiktok: 'tiktok', فيديو: 'video', video: 'video',
  mention: 'mention', منشن: 'mention', setmention: 'setmention',
}

function resolveName(name) {
  return ALIASES[name] || name
}

const moduleCache = new Map()
function loadCommandModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name)
  const filePath = path.join(__dirname, '..', 'commands', `${name}.js`)
  if (!fs.existsSync(filePath)) return null
  const mod = require(filePath)
  moduleCache.set(name, mod)
  return mod
}

async function handlePassiveFeatures(sock, remoteJid, message, senderId, text) {
  try { store.addMessage(remoteJid, message) } catch {}
  try {
    if (remoteJid.endsWith('@g.us')) topMembersModule().incrementMessageCount?.(remoteJid, senderId)
  } catch {}
  try { await mentionModule().handleMentionDetection?.(sock, remoteJid, message) } catch {}
  try { await chatbotModule().handleChatbotResponse?.(sock, remoteJid, message, text, senderId) } catch {}
  return false
}

async function runMappedCommand(name, sock, chatId, message, senderId, parsed) {
  const args = parsed.args
  const rest = parsed.rest
  const ctx = message?.message?.extendedTextMessage?.contextInfo || {}
  const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []
  const quotedMessage = ctx.quotedMessage || null
  const groupMeta = chatId.endsWith('@g.us') ? await sock.groupMetadata(chatId).catch(() => null) : null
  const adminInfo = chatId.endsWith('@g.us') ? await isAdmin(sock, chatId, senderId) : { isSenderAdmin: false, isBotAdmin: false }
  const mod = loadCommandModule(name)

  if (name === 'mention') return mentionModule().mentionToggleCommand?.(sock, chatId, message, rest, await isOwnerOrSudo(senderId, sock, chatId))
  if (name === 'setmention') return mentionModule().setMentionCommand?.(sock, chatId, message, await isOwnerOrSudo(senderId, sock, chatId))
  if (name === 'chatbot') return chatbotModule().handleChatbotCommand?.(sock, chatId, message, args[0])
  if (name === 'topmembers') return topMembersModule().topMembers?.(sock, chatId, chatId.endsWith('@g.us'))
  if (name === 'tictactoe') return tttModule().tictactoeCommand?.(sock, chatId, senderId, rest)
  if (name === 'setgname' || name === 'setgdesc' || name === 'setgpp') {
    const gm = loadCommandModule('groupmanage')
    if (!gm) return false
    if (name === 'setgname') return gm.setGroupName(sock, chatId, senderId, rest, message)
    if (name === 'setgdesc') return gm.setGroupDescription(sock, chatId, senderId, rest, message)
    return gm.setGroupPhoto(sock, chatId, senderId, message)
  }
  if (!mod) return false

  if (name === 'anime') return (mod.animeCommand || mod)(sock, chatId, message, args)
  if (name === 'misc') return (mod.miscCommand || mod)(sock, chatId, message, args)
  if (name === 'welcome') return (mod.welcomeCommand || mod)(sock, chatId, message, rest)
  if (name === 'goodbye') return (mod.goodbyeCommand || mod)(sock, chatId, message, rest)
  if (name === 'mute') return mod(sock, chatId, senderId, message, Number(args[0] || 0) || 0)
  if (name === 'unmute') return mod(sock, chatId)
  if (name === 'promote') return mod(sock, chatId, mentioned, message)
  if (name === 'demote') return mod(sock, chatId, mentioned, message)
  if (name === 'kick') return mod(sock, chatId, senderId, mentioned, message)
  if (name === 'warn') return mod(sock, chatId, senderId, mentioned, message)
  if (name === 'warnings') return mod(sock, chatId, mentioned)
  if (name === 'delete') return mod(sock, chatId, message, senderId)
  if (name === 'hidetag') return mod(sock, chatId, message)
  if (name === 'tagall' || name === 'tagnotadmin') return mod(sock, chatId, senderId, message)
  if (name === 'lyrics') return mod(sock, chatId, rest, message)
  if (name === 'weather') return mod(sock, chatId, message, rest)
  if (name === 'translate') return mod(sock, chatId, message, rest)
  if (name === 'ss') return mod(sock, chatId, message, rest)
  if (name === 'simage') return mod(sock, quotedMessage || message, chatId)
  if (name === 'removebg' || name === 'remini') return mod(sock, message)
  if (name === 'ship') return mod(sock, chatId, message, groupMeta)
  if (name === 'simp' || name === 'stupid') return mod(sock, chatId, quotedMessage, mentioned[0], senderId, args)
  if (name === 'take') return mod(sock, chatId, message, args)
  if (name === 'textmaker') return mod(sock, chatId, message, rest, args[0] || '')
  if (name === 'attp') return mod(sock, chatId, message)
  if (name === 'play' || name === 'song' || name === 'video' || name === 'spotify' || name === 'facebook' || name === 'instagram' || name === 'tiktok') return mod(sock, chatId, message)
  if (name === 'pair' || name === 'autostatus' || name === 'pmblocker' || name === 'anticall' || name === 'antidelete') return mod(sock, chatId, message, rest)
  if (name === 'antibadword') return mod(sock, chatId, message, senderId, adminInfo.isSenderAdmin)
  if (name === 'antilink' || name === 'antitag') return mod.handleAntilinkCommand ? mod.handleAntilinkCommand(sock, chatId, parsed.text, senderId, adminInfo.isSenderAdmin, message) : mod.handleAntitagCommand(sock, chatId, parsed.text, senderId, adminInfo.isSenderAdmin, message)
  return typeof mod === 'function' ? mod(sock, chatId, message) : false
}

async function dispatchMessage(sock, remoteJid, message, senderId) {
  const text = extractText(message)
  if (!text) return false

  try {
    if (/^(surrender|give up|[1-9])$/i.test(text.trim())) {
      await tttModule().handleTicTacToeMove?.(sock, remoteJid, senderId, text.trim())
    }
  } catch {}

  const parsed = parseCommand(text)
  if (!parsed) {
    await handlePassiveFeatures(sock, remoteJid, message, senderId, text)
    return false
  }

  const name = resolveName(parsed.name)
  try {
    const handled = await runMappedCommand(name, sock, remoteJid, message, senderId, parsed)
    return handled !== false
  } catch (error) {
    console.error('[king-saqr dispatcher]', name, error?.message || error)
    try {
      await sock.sendMessage(remoteJid, { text: `❌ حصل خطأ أثناء تنفيذ الأمر: ${name}` }, { quoted: message })
    } catch {}
    return true
  }
}

async function handleGroupParticipantsUpdate(sock, update) {
  try {
    const action = String(update?.action || '').toLowerCase()
    if (action === 'add') {
      await welcomeModule().handleJoinEvent?.(sock, update.id, update.participants || [])
    } else if (action === 'remove') {
      await goodbyeModule().handleLeaveEvent?.(sock, update.id, update.participants || [])
    }
  } catch (error) {
    console.error('[king-saqr group participants]', error?.message || error)
  }
}

module.exports = { dispatchMessage, handleGroupParticipantsUpdate }
