from pathlib import Path
import re

root = Path('/home/user/Fares')

# ---------------- db.js ----------------
db_path = root / 'db.js'
db = db_path.read_text()

db = db.replace("  antiLink: 'off',\n", "  antiLink: 'off',\n  antiSpam: 'off',\n")
db = db.replace("  autoStatusRead: 'on',\n  autoStatusReact: 'on',\n", "  autoStatusRead: 'on',\n  autoStatusReact: 'on',\n  statusViewBoost: 'off',\n")

db = db.replace(
"  n.settings = next\n  if (next.statusCustomReact && (!n.emoji || !n.emoji.trim())) {\n    n.emoji = next.statusCustomReact.trim().split(',')[0] || DEFAULT_EMOJI\n  }\n",
"  n.settings = next\n  n.autoViewStatus = String(next.autoStatusRead || 'on').toLowerCase() !== 'off'\n  n.autoReactStatus = String(next.autoStatusReact || 'on').toLowerCase() !== 'off'\n  if (next.statusCustomReact) {\n    n.emoji = next.statusCustomReact.trim().split(',')[0] || DEFAULT_EMOJI\n  }\n"
)

db_path.write_text(db)

# ---------------- whatsapp.js ----------------
wa_path = root / 'whatsapp.js'
wa = wa_path.read_text()

wa = wa.replace("  antibad: 'antiBad',\n", "  antibad: 'antiBad',\n  antispam: 'antiSpam',\n")
wa = wa.replace("  antiBad: ['antibad', 'سيء', 'مكافحة.سيء', 'antiBad'],\n", "  antiBad: ['antibad', 'سيء', 'مكافحة.سيء', 'antiBad'],\n  antiSpam: ['antispam', 'سبام', 'مكافحة.سبام', 'antiSpam'],\n")
wa = wa.replace("      this.groupWarnings = new Map()\n", "      this.groupWarnings = new Map()\n    this.spamTracker = new Map()\n")

insert_after = "  isLikelyAutomatedMessage(msg, text = '') {\n    const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}\n    const inner = unwrapMessageObject(raw)\n    const pushName = String(msg?.pushName || '').trim().toLowerCase()\n    if (/(^|\\b)(bot|بوت)(\\b|$)/i.test(pushName)) return true\n    if (inner?.buttonsMessage || inner?.listMessage || inner?.templateMessage || inner?.interactiveMessage) return true\n    const body = String(text || '').trim()\n    return /^[.\\/#!][a-z0-9_-]{2,}\\b/i.test(body) && body.split(/\\s+/).length > 4\n  }\n"

spam_helpers = "\n  pruneSpamTracker(maxAgeMs = 1000 * 60 * 5, maxEntries = 800) {\n    const now = Date.now()\n    for (const [key, entry] of this.spamTracker.entries()) {\n      if (!entry || now - Number(entry.lastAt || 0) > maxAgeMs) this.spamTracker.delete(key)\n    }\n    if (this.spamTracker.size <= maxEntries) return\n    const excess = this.spamTracker.size - maxEntries\n    const keys = Array.from(this.spamTracker.keys()).slice(0, excess)\n    for (const key of keys) this.spamTracker.delete(key)\n  }\n\n  isSpamMessage(groupJid, participantJid, text = '') {\n    const body = String(text || '').trim().toLowerCase()\n    if (!body) return false\n    this.pruneSpamTracker()\n    const key = `${String(groupJid || '').trim()}::${String(participantJid || '').trim()}`\n    const now = Date.now()\n    const entry = this.spamTracker.get(key) || { count: 0, lastAt: 0, lastText: '', duplicateCount: 0 }\n    const delta = now - Number(entry.lastAt || 0)\n\n    if (delta <= 9000) entry.count += 1\n    else entry.count = 1\n\n    if (entry.lastText && entry.lastText === body && delta <= 20000) entry.duplicateCount += 1\n    else entry.duplicateCount = 1\n\n    entry.lastAt = now\n    entry.lastText = body\n    this.spamTracker.set(key, entry)\n\n    const mentions = (body.match(/@/g) || []).length\n    const longRepeat = /(.)\\1{8,}/.test(body)\n    const manyChars = body.length > 700\n    return entry.count >= 5 || entry.duplicateCount >= 3 || mentions >= 6 || longRepeat || manyChars\n  }\n"
if spam_helpers not in wa:
    wa = wa.replace(insert_after, insert_after + spam_helpers)

wa = wa.replace(
"    const record = db.getNumber(this.userId, this.number)\n    if (!record) return false\n    let reactionResult = null\n    const tasks = []\n    if (record.autoViewStatus !== false) {\n",
"    const record = db.getNumber(this.userId, this.number)\n    if (!record) return false\n    const settings = record.settings || {}\n    let reactionResult = null\n    const tasks = []\n    if (String(settings.autoStatusRead || 'on').toLowerCase() !== 'off') {\n"
)
wa = wa.replace(
"    if (record.autoReactStatus !== false) {\n",
"    if (String(settings.autoStatusReact || 'on').toLowerCase() !== 'off') {\n"
)

wa = wa.replace(
"    if (settings.antiBad === 'on' && containsBlockedWord(text, parseListSetting(settings.antiBadWords))) {\n      return this.applyProtectionAction(groupJid, participantJid, msg, 'الكلمات الممنوعة', settings)\n    }\n\n    if (settings.antiMention === 'on' && extractMentionedJids(msg).length) {\n",
"    if (settings.antiBad === 'on' && containsBlockedWord(text, parseListSetting(settings.antiBadWords))) {\n      return this.applyProtectionAction(groupJid, participantJid, msg, 'الكلمات الممنوعة', settings)\n    }\n\n    if (settings.antiSpam === 'on' && this.isSpamMessage(groupJid, participantJid, text)) {\n      return this.applyProtectionAction(groupJid, participantJid, msg, 'السبام أو التكرار', settings, { warningText: 'تم رصد سبام أو تكرار مزعج' })\n    }\n\n    if (settings.antiMention === 'on' && extractMentionedJids(msg).length) {\n"
)

wa_path.write_text(wa)

# ---------------- web.js rewrite ----------------
web_content = r'''const express = require('express')
const path = require('path')
const fs = require('fs')
const config = require('./config')
const db = require('./db')
const whatsapp = require('./whatsapp')
const telegramAlerts = require('./telegram')
const monitor = require('./monitor')
const mediaDownloader = require('./media-downloader')

const TEMP_DOWNLOAD_TTL_MS = 1000 * 60 * 10
const tempDownloads = new Map()

function formatApiComment(comment) {
  return {
    id: comment.id,
    name: comment.name,
    contact: comment.contact,
    message: comment.message,
    status: comment.status,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    reply: comment.reply
      ? {
          text: comment.reply.text,
          by: comment.reply.by,
          createdAt: comment.reply.createdAt,
        }
      : null,
  }
}

function createAdminMiddleware() {
  return (req, res, next) => {
    const token = String(req.headers['x-admin-token'] || req.body?.token || req.query?.token || '').trim()
    if (!token || token !== String(config.SITE_ADMIN_TOKEN || '').trim()) {
      return res.status(401).json({ ok: false, error: 'غير مصرح' })
    }
    next()
  }
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .trim()
}

function buildBuiltinAiReply(prompt) {
  const normalized = String(prompt || '').trim().toLowerCase()
  const replies = []

  if (/ربط|اقتران|pair|pairing|code|كود/.test(normalized)) {
    replies.push('لربط رقم واتساب جديد: افتح بوت تيليجرام، اختر «ربط رقم جديد»، ثم أرسل الرقم بصيغته الدولية بدون + أو مسافات. ويمكنك أيضاً توليد كود الاقتران من صفحة الهبوط أو من لوحة التحكم داخل الموقع.')
  }
  if (/لوحة|بوابة|dashboard|panel|portal/.test(normalized)) {
    replies.push('لوحة التحكم تسمح لك بضبط الحماية، التفاعل مع الحالات، الردود الذكية، سجل التفاعلات، وكلمة المرور الخاصة بالرقم المربوط.')
  }
  if (/تحميل|تيك|انستا|instagram|tiktok|download/.test(normalized)) {
    replies.push('يمكنك استخدام أداة تنزيل الوسائط داخل الموقع: ألصق رابط TikTok أو Instagram وسيتم تجهيز رابط تنزيل مباشر إذا كان المحتوى عاماً ومدعوماً.')
  }
  if (/ذكاء|ai|ردود|keywords|كلمات/.test(normalized)) {
    replies.push('قسم الردود الذكية داخل اللوحة يتيح تحديد نطاق الرد الذكي inbox أو groups، وإضافة كلمات مفتاحية وردود مخصصة لكل رقم مربوط.')
  }
  if (/حالة|ستور|status|react/.test(normalized)) {
    replies.push('تم تجهيز المنصة لإظهار حالة مشاهدة الحالات والتفاعل التلقائي عليها، مع مؤشرات مباشرة وسجل للتفاعلات الناجحة داخل لوحة الرقم.')
  }
  if (!replies.length) {
    replies.push('أنا مساعد موقع Fares Bot. أستطيع مساعدتك في ربط الرقم، لوحة التحكم، تنزيل الوسائط، الردود الذكية، وإعدادات الحماية.')
  }
  return replies.join('\n\n')
}

async function resolveAiReply(prompt) {
  const cleanPrompt = String(prompt || '').trim().slice(0, config.AI_CHAT_MAX_PROMPT_CHARS)
  if (!cleanPrompt) throw new Error('empty_prompt')
  if (!config.AI_CHAT_ENABLED) return 'المساعد الذكي غير مفعل حالياً في هذا الموقع.'
  if (!config.AI_CHAT_ENDPOINT) return buildBuiltinAiReply(cleanPrompt)

  const payload = {
    prompt: cleanPrompt,
    system: config.AI_CHAT_SYSTEM_PROMPT,
    site: {
      title: config.SITE_TITLE,
      description: config.SITE_DESCRIPTION,
      url: config.WEBSITE_URL,
    },
  }

  const headers = { 'Content-Type': 'application/json' }
  if (config.AI_CHAT_API_KEY) headers.Authorization = `Bearer ${config.AI_CHAT_API_KEY}`

  const response = await fetch(config.AI_CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`ai_http_${response.status}`)
  const data = await response.json().catch(() => ({}))
  const reply = data.reply || data.message || data.answer || data.text || data.output || data.result || ''
  return stripMarkdown(reply) || buildBuiltinAiReply(cleanPrompt)
}

function pruneTempDownloads() {
  const now = Date.now()
  for (const [token, entry] of tempDownloads.entries()) {
    if (!entry || now > Number(entry.expiresAt || 0)) {
      try {
        if (entry?.filePath) mediaDownloader.cleanupDownloadedFile(entry.filePath)
      } catch {}
      tempDownloads.delete(token)
    }
  }
}

function registerTempDownload(filePath, metadata = {}) {
  pruneTempDownloads()
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
  tempDownloads.set(token, {
    filePath,
    metadata,
    createdAt: Date.now(),
    expiresAt: Date.now() + TEMP_DOWNLOAD_TTL_MS,
  })
  return token
}

function startWebServer({ getRuntimeStats, monitor: monitorMod = monitor }) {
  const app = express()
  const adminOnly = createAdminMiddleware()
  const publicDir = path.join(__dirname, 'public')

  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(express.static(publicDir, { extensions: ['html'] }))

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'fares-bot-site' })
  })

  app.get('/api/public/config', (req, res) => {
    res.json({
      ok: true,
      config: {
        siteTitle: config.SITE_TITLE,
        siteDescription: config.SITE_DESCRIPTION,
        websiteUrl: config.WEBSITE_URL,
        ownerPanelUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/panel`,
        dashboardUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/dashboard`,
        downloaderUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/downloader`,
        whatsappChannelUrl: config.WHATSAPP_CHANNEL_URL,
        developerWhatsappUrl: config.DEVELOPER_WHATSAPP_URL,
        developerWhatsappNumber: config.DEVELOPER_WHATSAPP,
        telegramBotUrl: config.TELEGRAM_BOT_URL,
        dailyCoinAmount: db.DAILY_COIN_AMOUNT,
        coinStore: db.COIN_STORE,
        aiChatEnabled: config.AI_CHAT_ENABLED,
        aiPageUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/ai`,
      },
    })
  })

  app.post('/api/public/ai-chat', async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim()
      if (!prompt) return res.status(400).json({ ok: false, error: 'الرسالة مطلوبة.' })
      if (prompt.length > config.AI_CHAT_MAX_PROMPT_CHARS) {
        return res.status(400).json({ ok: false, error: 'الرسالة طويلة جداً.' })
      }
      const reply = await resolveAiReply(prompt)
      res.json({ ok: true, reply })
    } catch (e) {
      const useFallback = String(e.message || '').startsWith('ai_http_')
      if (useFallback) return res.json({ ok: true, reply: buildBuiltinAiReply(String(req.body?.prompt || '')) })
      const error = e.message === 'empty_prompt' ? 'الرسالة مطلوبة.' : 'تعذر تجهيز الرد حالياً.'
      res.status(400).json({ ok: false, error })
    }
  })

  app.get('/api/public/stats', (req, res) => {
    res.json({ ok: true, stats: db.getStats(getRuntimeStats()) })
  })

  app.get('/api/public/comments', (req, res) => {
    const comments = db.listComments().slice(0, Math.max(1, config.MAX_PUBLIC_COMMENTS)).map(formatApiComment)
    res.json({ ok: true, comments })
  })

  app.post('/api/public/comments', (req, res) => {
    const name = String(req.body?.name || '').trim()
    const contact = String(req.body?.contact || '').trim()
    const message = String(req.body?.message || '').trim()
    if (!name || name.length < 2) return res.status(400).json({ ok: false, error: 'الاسم يجب أن يكون حرفين على الأقل.' })
    if (!message || message.length < 5) return res.status(400).json({ ok: false, error: 'التعليق أو الاستفسار قصير جداً.' })
    if (message.length > 1200) return res.status(400).json({ ok: false, error: 'التعليق طويل جداً.' })
    const created = db.addComment({ name, contact, message })
    res.status(201).json({ ok: true, comment: formatApiComment(created) })
  })

  app.post('/api/public/pairing-code', async (req, res) => {
    try {
      const number = String(req.body?.number || '').replace(/\D/g, '')
      const accepted = req.body?.accepted === true || String(req.body?.accepted || '') === 'true'
      if (!accepted) return res.status(400).json({ ok: false, error: 'يجب تأكيد أنك تستخدم رقماً مخصصاً للربط.' })
      if (!/^\d{8,15}$/.test(number)) return res.status(400).json({ ok: false, error: 'صيغة الرقم غير صحيحة.' })
      const result = await whatsapp.requestIsolatedPairingCode(number)
      const rawCode = String(result?.code || '').replace(/[^A-Za-z0-9]/g, '')
      const code = result?.formatted || rawCode.replace(/(.{4})/g, '$1-').replace(/-$/, '')
      res.json({
        ok: true,
        rawCode,
        code,
        panelUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/panel/${number}`,
        expiresInSeconds: 60,
      })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'تعذر إصدار كود الاقتران حالياً.' })
    }
  })

  app.post('/api/public/media-download', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim()
      if (!url) return res.status(400).json({ ok: false, error: 'رابط الوسائط مطلوب.' })
      const result = await mediaDownloader.downloadSocialVideo(url)
      const token = registerTempDownload(result.filePath, result.metadata || {})
      res.json({
        ok: true,
        platform: result.platform,
        title: result.metadata?.title || 'media-download',
        thumbnail: result.metadata?.thumbnail || null,
        downloadUrl: `/api/public/media-file/${token}`,
        expiresInSeconds: Math.floor(TEMP_DOWNLOAD_TTL_MS / 1000),
      })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تنزيل الوسائط من هذا الرابط.' })
    }
  })

  app.get('/api/public/media-file/:token', (req, res) => {
    pruneTempDownloads()
    const token = String(req.params.token || '').trim()
    const entry = tempDownloads.get(token)
    if (!entry || !entry.filePath || !fs.existsSync(entry.filePath)) {
      return res.status(404).send('انتهت صلاحية الملف أو لم يعد متوفراً.')
    }
    const ext = path.extname(entry.filePath) || '.mp4'
    const base = String(entry.metadata?.title || 'fares-media').replace(/[^\w\u0600-\u06FF.-]+/g, '_')
    res.download(entry.filePath, `${base}${ext}`, (err) => {
      try { mediaDownloader.cleanupDownloadedFile(entry.filePath) } catch {}
      tempDownloads.delete(token)
      if (err && !res.headersSent) res.status(500).send('تعذر إرسال الملف.')
    })
  })

  app.post('/api/admin/login', (req, res) => {
    const token = String(req.body?.token || '').trim()
    if (!token || token !== String(config.SITE_ADMIN_TOKEN || '').trim()) {
      return res.status(401).json({ ok: false, error: 'رمز الدخول غير صحيح.' })
    }
    res.json({ ok: true })
  })

  app.get('/api/admin/comments', adminOnly, (req, res) => {
    const comments = db.listComments({ includeHidden: true }).map(formatApiComment)
    res.json({ ok: true, comments })
  })

  app.post('/api/admin/comments/:id/reply', adminOnly, (req, res) => {
    try {
      const reply = String(req.body?.reply || '').trim()
      const by = String(req.body?.by || 'المطور').trim() || 'المطور'
      const updated = db.replyToComment(req.params.id, reply, by)
      res.json({ ok: true, comment: formatApiComment(updated) })
    } catch (e) {
      const status = e.message === 'comment_not_found' ? 404 : 400
      res.status(status).json({ ok: false, error: e.message === 'comment_not_found' ? 'التعليق غير موجود.' : 'الرد غير صالح.' })
    }
  })

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  app.get('/api/panel/:number/default-password', (req, res) => {
    const num = String(req.params.number || '').replace(/\D/g, '')
    if (!num) return res.status(400).json({ ok: false, error: 'رقم غير صالح.' })
    const record = db.getAllNumbers().find((n) => n.number === num)
    if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط على هذا البوت.' })
    res.json({ ok: true, defaultPassword: db.getDefaultPanelPasswordFor(num), hasCustomPassword: Boolean(record.panelPasswordHash) })
  })

  app.post('/api/panel/login', (req, res) => {
    try {
      const number = String(req.body?.number || '').replace(/\D/g, '')
      const password = String(req.body?.password || '').trim()
      if (!number || !password) return res.status(400).json({ ok: false, error: 'الرقم وكلمة المرور مطلوبان.' })
      const owner = db.numberOwner(number)
      if (!owner) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط.' })
      const record = db.getNumber(owner, number)
      if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير موجود.' })
      const ok = record.panelPasswordHash ? db.verifyPanelPassword(record.panelPasswordHash, password) : password === db.getDefaultPanelPasswordFor(number)
      if (!ok) return res.status(401).json({ ok: false, error: 'كلمة المرور غير صحيحة.' })
      const token = db.createPanelSession(owner, number)
      res.json({ ok: true, token, userId: owner, number, settings: db.getPhoneSettings(owner, number), status: record.status, wallet: db.getWalletSummary(owner, number) })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'خطأ غير متوقع.' })
    }
  })

  app.post('/api/panel/logout', (req, res) => {
    const token = String(req.body?.token || req.headers['x-panel-token'] || '').trim()
    db.destroyPanelSession(token)
    res.json({ ok: true })
  })

  function requirePanelSession(req, res, next) {
    const number = String(req.params.number || '').replace(/\D/g, '')
    const token = String(req.body?.token || req.headers['x-panel-token'] || req.query?.token || '').trim()
    const sess = db.getPanelSession(token)
    if (!sess || sess.number !== number) return res.status(401).json({ ok: false, error: 'انتهت الجلسة. سجّل الدخول مجدداً.' })
    req.panelSession = sess
    next()
  }

  app.get('/api/panel/:number/settings', requirePanelSession, (req, res) => {
    const sess = req.panelSession
    const settings = db.getPhoneSettings(sess.userId, sess.number)
    const record = db.getNumber(sess.userId, sess.number)
    res.json({ ok: true, number: sess.number, userId: sess.userId, status: record?.status || 'unknown', emoji: record?.emoji || settings.statusCustomReact, settings, defaults: db.getDefaultPhoneSettings() })
  })

  app.post('/api/panel/:number/settings', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      const patch = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body || {}
      delete patch.token
      const next = db.setPhoneSettings(sess.userId, sess.number, patch)
      res.json({ ok: true, settings: next })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر الحفظ.' })
    }
  })

  app.post('/api/panel/:number/password', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      const current = String(req.body?.currentPassword || '').trim()
      const next = String(req.body?.newPassword || '').trim()
      if (!current || !next || next.length < 4) {
        return res.status(400).json({ ok: false, error: 'كلمة المرور الحالية والجديدة (4 أحرف على الأقل) مطلوبة.' })
      }
      const record = db.getNumber(sess.userId, sess.number)
      const ok = record.panelPasswordHash ? db.verifyPanelPassword(record.panelPasswordHash, current) : current === db.getDefaultPanelPasswordFor(sess.number)
      if (!ok) return res.status(401).json({ ok: false, error: 'كلمة المرور الحالية غير صحيحة.' })
      db.setPanelPassword(sess.userId, sess.number, next)
      res.json({ ok: true })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحديث كلمة المرور.' })
    }
  })

  app.post('/api/panel/:number/pair', requirePanelSession, async (req, res) => {
    try {
      const target = String(req.body?.number || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(target)) return res.status(400).json({ ok: false, error: 'صيغة الرقم الهدف غير صحيحة.' })
      const result = await whatsapp.requestIsolatedPairingCode(target)
      res.json({ ok: true, code: result?.formatted || result?.code || '' , rawCode: result?.code || '' })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'تعذر إصدار كود الاقتران.' })
    }
  })

  app.get('/api/panel/:number/wallet', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({ ok: true, wallet: db.getWalletSummary(sess.userId, sess.number), store: db.getCoinStoreCatalog(sess.userId, sess.number) })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحميل المحفظة.' })
    }
  })

  app.post('/api/panel/:number/claim-daily', requirePanelSession, async (req, res) => {
    try {
      const sess = req.panelSession
      const result = db.claimDailyCoins(sess.userId, sess.number)
      let notificationSent = false
      try {
        const text = [`🎁 تم الحصول على ${result.amount} عملة مجانية لرقمك ${sess.number}.`,`💰 الرصيد الحالي: ${result.wallet.balance} عملة.`,`🕒 الاستلام القادم بعد 24 ساعة من الآن.`].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}
      res.json({ ok: true, amount: result.amount, wallet: result.wallet, notificationSent })
    } catch (e) {
      if (e.message === 'daily_not_ready') {
        return res.status(429).json({ ok: false, error: 'تم استلام المكافأة اليومية مسبقاً.', nextClaimAt: e.nextClaimAt || null, remainingMs: e.remainingMs || 0 })
      }
      res.status(400).json({ ok: false, error: e.message || 'تعذر استلام المكافأة اليومية.' })
    }
  })

  app.post('/api/panel/:number/store/buy', requirePanelSession, async (req, res) => {
    try {
      const sess = req.panelSession
      const offerKey = String(req.body?.offerKey || '').trim()
      const result = db.purchaseCoinFeature(sess.userId, sess.number, offerKey)
      let notificationSent = false
      try {
        const text = [`🛒 تم شراء الميزة: ${result.offer.title}`,`💰 الرصيد المتبقي: ${result.wallet.balance} عملة.`,`⏳ الميزة مفعلة الآن على رقمك المربوط.`].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}
      res.json({ ok: true, result, notificationSent })
    } catch (e) {
      const code = e.message === 'offer_not_found' ? 404 : 400
      res.status(code).json({
        ok: false,
        error: e.message === 'offer_not_found' ? 'الميزة المطلوبة غير موجودة.' : e.message === 'insufficient_coins' ? 'رصيد العملات غير كافٍ لإتمام الشراء.' : e.message || 'تعذر إتمام عملية الشراء.',
        balance: e.balance,
        price: e.price,
      })
    }
  })

  app.get('/api/panel/:number/status-reactions', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({ ok: true, reactions: db.getStatusReactionState(sess.userId, sess.number) })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحميل سجل التفاعلات.' })
    }
  })

  app.get('/api/monitor/state', adminOnly, (req, res) => {
    try {
      const now = Date.now()
      const states = monitorMod.getStates().map((s) => ({
        number: s.number,
        emoji: (db.getNumber(s.userId, s.number) || {}).emoji || '❤️',
        joinedChannel: (db.getNumber(s.userId, s.number) || {}).joinedChannel === true,
        discSince: !!s.disconnectSince,
        discSinceMs: s.disconnectSince ? now - s.disconnectSince : 0,
        idleMs: now - (s.lastHeartbeat || s.firstSeenAt || now),
        lastReactionAgo: s.lastReaction ? formatAgo(s.lastReaction) : '—',
        lastAlertAgo: s.lastAlertAt ? formatAgo(s.lastAlertAt) : '—',
        lastRecoveryAgo: s.lastRecoveryAt ? formatAgo(s.lastRecoveryAt) : '—',
        lastStatusCode: s.lastStatusCode,
        reconnectAttempts: s.reconnectAttempts || 0,
        lastForceRestart: s.lastForceRestart || null,
        disconnectReason: s.lastDisconnectReason || null,
      }))
      res.json({
        ok: true,
        counts: {
          total: states.length,
          disconnected: states.filter((s) => s.discSince).length,
          stalled: states.filter((s) => !s.discSince && s.idleMs >= (config.ALERT_STALL_THRESHOLD_MS || 180000)).length,
          online: states.filter((s) => !s.discSince && s.idleMs < (config.ALERT_STALL_THRESHOLD_MS || 180000)).length,
        },
        states,
        alerts: telegramAlerts.getRecentErrors(),
        monitor: {
          disconnectThresholdMs: config.ALERT_DISCONNECT_THRESHOLD_MS,
          stallThresholdMs: config.ALERT_STALL_THRESHOLD_MS,
          cooldownMs: config.ALERT_COOLDOWN_MS,
          enabled: !!config.ALERT_ENABLED,
          token: telegramAlerts.pickToken() ? 'set' : 'missing',
          chatId: telegramAlerts.pickChatId() || 'missing',
        },
      })
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) })
    }
  })

  app.post('/api/monitor/test-alert', adminOnly, async (req, res) => {
    try {
      const text = String(req.body?.text || '✅ تنبيه اختباري من لوحة مراقبة Fares Bot').slice(0, 1000)
      const result = await telegramAlerts.sendAlert(text)
      res.json(result)
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) })
    }
  })

  app.get(['/ai'], (req, res) => res.sendFile(path.join(publicDir, 'ai.html')))
  app.get(['/panel', '/panel/:number', '/dashboard'], (req, res) => res.sendFile(path.join(publicDir, 'panel.html')))
  app.get(['/downloader'], (req, res) => res.sendFile(path.join(publicDir, 'downloader.html')))
  app.get(['/monitor'], (req, res) => res.sendFile(path.join(publicDir, 'monitor.html')))

  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  function formatAgo(ts) {
    if (!ts) return '—'
    const ms = Date.now() - ts
    if (ms < 0) return '—'
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rs = s % 60
    if (m < 60) return `${m}m ${rs}s`
    const h = Math.floor(m / 60)
    const rm = m % 60
    return `${h}h ${rm}m`
  }

  const server = app.listen(config.PORT, () => {
    console.log(`🌐 الموقع يعمل على المنفذ ${config.PORT}`)
    console.log(`🔗 رابط الموقع: ${config.WEBSITE_URL}`)
  })

  setInterval(pruneTempDownloads, 60_000).unref?.()

  return { app, server }
}

module.exports = { startWebServer }
'''
(root / 'web.js').write_text(web_content)

# ---------------- public files ----------------
(root / 'public' / 'app-v2.css').write_text(r''':root {
  --bg: #07111f;
  --bg-2: #0b1730;
  --surface: rgba(10, 19, 39, 0.84);
  --surface-2: rgba(14, 25, 49, 0.92);
  --line: rgba(148, 163, 184, 0.16);
  --text: #e6eefb;
  --muted: #94a3b8;
  --primary: #3b82f6;
  --secondary: #14b8a6;
  --accent: #8b5cf6;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --shadow: 0 24px 60px rgba(2, 8, 23, 0.45);
  --radius: 24px;
}
*{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;font-family:Cairo,system-ui,sans-serif;background:radial-gradient(circle at top right,#11214a 0,#07111f 35%,#050b16 100%);color:var(--text)} a{text-decoration:none;color:inherit}
img{max-width:100%;display:block} button,input,select,textarea{font:inherit}
.shell{width:min(1200px,calc(100% - 32px));margin:auto}.hidden{display:none!important}
.page-bg{position:fixed;inset:0;pointer-events:none;overflow:hidden}.orb{position:absolute;border-radius:999px;filter:blur(80px);opacity:.35}.orb.a{width:340px;height:340px;right:-60px;top:-70px;background:#2563eb}.orb.b{width:360px;height:360px;left:-80px;top:30%;background:#14b8a6}.orb.c{width:300px;height:300px;right:25%;bottom:-100px;background:#8b5cf6}.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:40px 40px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.75),transparent)}
.topbar{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:20px 0;position:sticky;top:0;z-index:10;background:linear-gradient(180deg,rgba(7,17,31,.94),rgba(7,17,31,.64),transparent);backdrop-filter:blur(12px)}
.brand{display:flex;align-items:center;gap:14px}.brand-badge{width:52px;height:52px;border-radius:18px;background:linear-gradient(135deg,var(--primary),var(--accent));display:grid;place-items:center;font-weight:900;box-shadow:var(--shadow)}.brand small{display:block;color:var(--muted)}
.nav{display:flex;gap:12px;flex-wrap:wrap}.btn{border:none;border-radius:16px;padding:14px 18px;display:inline-flex;align-items:center;gap:10px;cursor:pointer;transition:.2s transform,.2s opacity,.2s background,.2s border-color}.btn:hover{transform:translateY(-2px)}.btn-primary{background:linear-gradient(135deg,var(--primary),#2563eb);color:#fff;box-shadow:0 18px 35px rgba(37,99,235,.28)}.btn-secondary{background:linear-gradient(135deg,var(--secondary),#0f766e);color:#fff;box-shadow:0 18px 35px rgba(20,184,166,.22)}.btn-ghost{background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--text)}.btn-danger{background:linear-gradient(135deg,var(--danger),#b91c1c);color:#fff}
.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:28px;padding:40px 0 22px}.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.hero-copy,.hero-side,.section{padding:28px}.eyebrow{display:inline-flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:rgba(59,130,246,.12);color:#bfdbfe;border:1px solid rgba(59,130,246,.22);font-size:.9rem}.eyebrow::before{content:'';width:10px;height:10px;border-radius:999px;background:var(--secondary);box-shadow:0 0 0 6px rgba(20,184,166,.12)}
h1{font-size:clamp(2rem,4vw,4rem);line-height:1.15;margin:18px 0 16px}.lead{font-size:1.06rem;line-height:1.9;color:#cbd5e1}.hero-actions,.stack-actions,.form-actions,.panel-actions{display:flex;gap:12px;flex-wrap:wrap}.hero-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}.metric{padding:18px;border-radius:20px;background:rgba(255,255,255,.03);border:1px solid var(--line)}.metric span{display:block;color:var(--muted);font-size:.92rem}.metric strong{display:block;font-size:1.7rem;margin-top:8px}
.side-panel-title{margin:0 0 8px;font-size:1.4rem}.muted{color:var(--muted);line-height:1.8}.field{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}.field span,.field label{color:#cbd5e1;font-size:.94rem}.field input,.field select,.field textarea{width:100%;border-radius:16px;border:1px solid rgba(148,163,184,.18);background:rgba(255,255,255,.04);color:var(--text);padding:14px 16px;outline:none}.field textarea{min-height:120px;resize:vertical}.field input:focus,.field select:focus,.field textarea:focus{border-color:rgba(59,130,246,.6);box-shadow:0 0 0 4px rgba(59,130,246,.12)}
.status{min-height:24px;color:var(--muted);font-size:.94rem}.status.success{color:#86efac}.status.error{color:#fca5a5}.status.warn{color:#fde68a}
.sections{display:grid;gap:22px;padding:16px 0 42px}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:18px}.section-head h2,.section h2{margin:0;font-size:1.5rem}.section-head p{margin:8px 0 0;color:var(--muted)}
.feature-grid,.stats-grid,.dashboard-grid,.reaction-grid,.settings-grid,.store-grid{display:grid;gap:16px}.feature-grid{grid-template-columns:repeat(4,1fr)}.feature{padding:20px;border-radius:22px;background:rgba(255,255,255,.03);border:1px solid var(--line)}.feature h3{margin:14px 0 10px}.feature p{margin:0;color:var(--muted);line-height:1.8}.stats-grid{grid-template-columns:repeat(4,1fr)}.stat{padding:20px;border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.025));border:1px solid var(--line)}.stat span{display:block;color:var(--muted)}.stat strong{display:block;margin-top:8px;font-size:1.8rem}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:22px}.comment-list,.reaction-list,.transaction-list{display:grid;gap:14px}.comment-item,.reaction-item,.tx-item,.active-chip,.offer{padding:16px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid var(--line)}.comment-item strong,.reaction-item strong,.tx-item strong{display:block;margin-bottom:6px}.small{font-size:.9rem;color:var(--muted)}
.panel-shell{padding-bottom:40px}.login-card{max-width:540px;margin:40px auto}.dashboard-top{display:flex;justify-content:space-between;gap:14px;align-items:center;margin:24px 0}.pill{padding:8px 14px;border-radius:999px;background:rgba(34,197,94,.14);color:#bbf7d0;border:1px solid rgba(34,197,94,.28)}.pill.offline{background:rgba(239,68,68,.14);color:#fecaca;border-color:rgba(239,68,68,.28)}
.dashboard-grid{grid-template-columns:repeat(4,1fr)}.quick-card{padding:20px}.quick-card h3{margin-top:0}.toggles{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.toggle{padding:16px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid var(--line)}.toggle select{margin-top:10px}
.settings-group{padding:22px}.settings-grid{grid-template-columns:repeat(3,1fr)}.settings-group h3{margin-top:0}.offer-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.offer h3{margin:8px 0}.offer .price{font-size:1.5rem;font-weight:800}.offer.active{outline:1px solid rgba(34,197,94,.45)}
.kv{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px dashed rgba(148,163,184,.18)}.kv:last-child{border-bottom:none}.download-card{max-width:820px;margin:0 auto}
.footer{padding:22px 0 40px;color:var(--muted);text-align:center}
@media (max-width: 1080px){.hero,.two-col{grid-template-columns:1fr}.feature-grid,.stats-grid,.dashboard-grid,.settings-grid,.offer-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width: 720px){.nav,.hero-actions,.form-actions,.panel-actions,.dashboard-top{flex-direction:column;align-items:stretch}.feature-grid,.stats-grid,.dashboard-grid,.settings-grid,.offer-grid,.toggles,.hero-metrics{grid-template-columns:1fr}.shell{width:min(100% - 20px,1200px)}.hero-copy,.hero-side,.section{padding:20px}}
''')

(root / 'public' / 'index.html').write_text(r'''<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fares Bot | لوحة موقع متكاملة</title>
    <meta name="description" content="منصة عربية حديثة لإدارة Fares Bot: صفحة هبوط، لوحة تحكم، تنزيل وسائط، إعدادات حماية، وردود ذكية." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/app-v2.css" />
  </head>
  <body>
    <div class="page-bg"><div class="orb a"></div><div class="orb b"></div><div class="orb c"></div><div class="grid"></div></div>
    <header class="topbar shell">
      <div class="brand"><div class="brand-badge">F</div><div><strong id="siteTitle">Fares Bot</strong><small>منصة إدارة متكاملة للبوت والتحميل ولوحة التحكم</small></div></div>
      <nav class="nav">
        <a class="btn btn-ghost" href="#features">المميزات</a>
        <a class="btn btn-ghost" href="#stats">الإحصائيات</a>
        <a class="btn btn-ghost" href="#comments">التعليقات</a>
        <a class="btn btn-secondary" href="/downloader">تنزيل الوسائط</a>
        <a class="btn btn-primary" href="/panel">لوحة التحكم</a>
      </nav>
    </header>

    <main class="shell">
      <section class="hero">
        <div class="hero-copy card">
          <span class="eyebrow">Dark Dashboard · Express · Node.js</span>
          <h1>تصميم عصري كامل لموقع البوت مع <span style="color:#93c5fd">لوحة تحكم</span> و<span style="color:#99f6e4">أداة تنزيل</span> و<span style="color:#c4b5fd">ذكاء ردود</span></h1>
          <p class="lead" id="siteDescription">واجهة عربية متجاوبة تعمل على الهاتف والكمبيوتر، تعرض مميزات البوت، الإحصائيات العامة، الدخول إلى لوحة التحكم، وتنزيل فيديوهات TikTok وInstagram من داخل الموقع مباشرة.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="/panel">فتح لوحة التحكم</a>
            <a class="btn btn-secondary" href="/downloader">أداة تحميل الوسائط</a>
            <a class="btn btn-ghost" href="#pairing">كود الاقتران</a>
          </div>
          <div class="hero-metrics">
            <div class="metric"><span>الأرقام المربوطة</span><strong id="statNumbers">0</strong></div>
            <div class="metric"><span>الجلسات المتصلة</span><strong id="statConnected">0</strong></div>
            <div class="metric"><span>تفاعلات الحالات</span><strong id="statReactions">0</strong></div>
            <div class="metric"><span>التعليقات</span><strong id="statComments">0</strong></div>
          </div>
        </div>

        <aside class="hero-side card" id="pairing">
          <h2 class="side-panel-title">تجهيز كود اقتران مباشر</h2>
          <p class="muted">أدخل الرقم الدولي ثم اطلب الكود. بعد الإنشاء سيتم عرض الكود ونسخه تلقائياً، مع رابط مباشر لصفحة هذا الرقم في لوحة التحكم.</p>
          <form id="pairForm">
            <div class="field"><span>رقم واتساب</span><input id="pairNumber" type="text" inputmode="numeric" placeholder="مثال: 9677XXXXXXX" required /></div>
            <div class="field"><label><input id="pairAccepted" type="checkbox" /> أؤكد أن الرقم مخصص للربط فقط</label></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">طلب كود الاقتران</button></div>
            <div id="pairStatus" class="status"></div>
          </form>
          <div id="pairResult" class="hidden">
            <div class="kv"><span>الكود</span><strong id="pairCode">—</strong></div>
            <div class="panel-actions"><button class="btn btn-ghost" id="copyPairBtn" type="button">نسخ الكود</button><a id="pairPanelLink" class="btn btn-secondary" href="/panel">فتح صفحة الرقم</a></div>
          </div>
        </aside>
      </section>

      <div class="sections">
        <section class="section card" id="features">
          <div class="section-head"><div><h2>الأقسام الأساسية التي تم تجهيزها</h2><p>صفحة هبوط احترافية، لوحة تحكم داخلية، تنزيل وسائط سريع، وإدارة الردود الذكية والحماية.</p></div></div>
          <div class="feature-grid">
            <article class="feature"><div class="eyebrow">Landing</div><h3>صفحة رئيسية احترافية</h3><p>عرض المميزات، الإحصائيات، أزرار ربط البوت والدخول إلى لوحة التحكم، مع تصميم افتراضي داكن متجاوب.</p></article>
            <article class="feature"><div class="eyebrow">Dashboard</div><h3>لوحة تحكم للرقم</h3><p>تسجيل دخول للرقم المربوط، إدارة الحماية، التفاعل مع الحالات، الردود الذكية، المحفظة، وسجل التفاعلات.</p></article>
            <article class="feature"><div class="eyebrow">Downloader</div><h3>تحميل TikTok وInstagram</h3><p>نافذة إدخال مخصصة لمعالجة الروابط وإخراج زر تحميل مباشر من الموقع دون الاعتماد على تيليجرام فقط.</p></article>
            <article class="feature"><div class="eyebrow">AI Replies</div><h3>نطاق الرد الذكي والكلمات المفتاحية</h3><p>إعداد inbox أو groups، وكتابة ردود مخصصة حسب الكلمات المفتاحية، مع حقول جاهزة للحفظ من اللوحة.</p></article>
          </div>
        </section>

        <section class="section card" id="stats">
          <div class="section-head"><div><h2>إحصائيات البوت</h2><p>تعرض بيانات التشغيل والجلسات وربط الأرقام بشكل لحظي من مشروع Node.js نفسه.</p></div><div class="small" id="statsUpdated">آخر تحديث: —</div></div>
          <div class="stats-grid">
            <div class="stat"><span>المستخدمون</span><strong id="totalUsers">0</strong></div>
            <div class="stat"><span>الأرقام المربوطة</span><strong id="totalNumbers">0</strong></div>
            <div class="stat"><span>المتصلة</span><strong id="connectedNumbers">0</strong></div>
            <div class="stat"><span>قيد الاقتران</span><strong id="pairingNumbers">0</strong></div>
            <div class="stat"><span>إعادة الاتصال</span><strong id="totalReconnects">0</strong></div>
            <div class="stat"><span>مشاهدة الحالات</span><strong id="totalStatusViews">0</strong></div>
            <div class="stat"><span>تفاعلات الحالات</span><strong id="totalStatusReactions">0</strong></div>
            <div class="stat"><span>الجلسات النشطة</span><strong id="activeSessions">0</strong></div>
          </div>
        </section>

        <section class="two-col">
          <section class="section card">
            <div class="section-head"><div><h2>دخول سريع إلى لوحة الرقم</h2><p>سجل دخولك بالرقم وكلمة المرور ثم انتقل مباشرة إلى لوحة التحكم الكاملة.</p></div></div>
            <form id="loginForm">
              <div class="field"><span>الرقم المربوط</span><input id="loginNumber" type="text" inputmode="numeric" placeholder="مثال: 9677XXXXXXX" required /></div>
              <div class="field"><span>كلمة المرور</span><input id="loginPassword" type="password" placeholder="كلمة المرور" required /></div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">تسجيل الدخول</button><a class="btn btn-ghost" href="/panel">فتح البوابة</a></div>
              <div id="loginStatus" class="status"></div>
            </form>
          </section>

          <section class="section card">
            <div class="section-head"><div><h2>تنزيل وسائط سريع</h2><p>أداة سريعة من الصفحة الرئيسية للوصول المباشر إلى صفحة التحميل.</p></div></div>
            <div class="comment-item">
              <strong>المنصات المدعومة</strong>
              <div class="small">TikTok · Instagram Reels / Posts</div>
            </div>
            <div class="comment-item">
              <strong>الاستخدام</strong>
              <div class="small">ألصق الرابط في صفحة التحميل وسيتم تجهيز زر تنزيل مباشر طالما أن الرابط عام ومدعوم.</div>
            </div>
            <div class="panel-actions"><a class="btn btn-secondary" href="/downloader">فتح صفحة التحميل</a><a id="channelLink" class="btn btn-ghost" href="#" target="_blank" rel="noreferrer">قناة الواتساب</a></div>
          </section>
        </section>

        <section class="section card" id="comments">
          <div class="section-head"><div><h2>تعليقات واستفسارات المستخدمين</h2><p>يمكن للمستخدم إرسال ملاحظته أو طلبه، ويظهر الرد لاحقاً في نفس الواجهة.</p></div></div>
          <form id="commentForm">
            <div class="two-col">
              <div class="field"><span>الاسم</span><input id="commentName" required /></div>
              <div class="field"><span>وسيلة التواصل</span><input id="commentContact" placeholder="اختياري" /></div>
            </div>
            <div class="field"><span>الرسالة</span><textarea id="commentMessage" required placeholder="اكتب ملاحظتك أو استفسارك هنا"></textarea></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">إرسال التعليق</button></div>
            <div id="commentStatus" class="status"></div>
          </form>
          <div id="commentsList" class="comment-list"></div>
        </section>
      </div>
    </main>

    <footer class="footer shell">تم تطوير الواجهة لتناسب مشروع Fares Bot الحالي باستخدام واجهة عربية داكنة متجاوبة ولوحة تحكم داخلية مرتبطة مباشرة بخادم Express.</footer>
    <script src="/landing.js"></script>
  </body>
</html>
''')

(root / 'public' / 'landing.js').write_text(r'''(() => {
  const state = { rawPairCode: '' }
  const $ = (id) => document.getElementById(id)
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value }
  const status = (id, text, kind='') => { const el = $(id); if (!el) return; el.className = `status ${kind}`.trim(); el.textContent = text || '' }
  const format = (n) => new Intl.NumberFormat('ar').format(Number(n || 0))
  const date = (v) => v ? new Date(v).toLocaleString('ar') : '—'
  async function api(url, options={}) {
    const opts = { method: 'GET', headers: {}, ...options }
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(opts.body)
    }
    const res = await fetch(url, opts)
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }
  async function loadConfig() {
    const { data } = await api('/api/public/config')
    if (!data.ok) return
    set('siteTitle', data.config.siteTitle)
    set('siteDescription', data.config.siteDescription)
    const channel = $('channelLink')
    if (channel) channel.href = data.config.whatsappChannelUrl || '#'
  }
  async function loadStats() {
    const { data } = await api('/api/public/stats')
    if (!data.ok) return
    const s = data.stats
    set('statNumbers', format(s.totalNumbers))
    set('statConnected', format(s.connected))
    set('statReactions', format(s.metrics?.totalStatusReactions))
    set('statComments', format(s.comments?.totalComments))
    set('totalUsers', format(s.totalUsers))
    set('totalNumbers', format(s.totalNumbers))
    set('connectedNumbers', format(s.connected))
    set('pairingNumbers', format(s.pairing))
    set('totalReconnects', format(s.metrics?.totalReconnects))
    set('totalStatusViews', format(s.metrics?.totalStatusViews))
    set('totalStatusReactions', format(s.metrics?.totalStatusReactions))
    set('activeSessions', format(s.runtime?.activeSessions))
    set('statsUpdated', `آخر تحديث: ${date(s.lastUpdatedAt)}`)
  }
  function renderComments(items=[]) {
    const wrap = $('commentsList')
    if (!wrap) return
    wrap.innerHTML = items.length ? items.map(item => `
      <article class="comment-item">
        <strong>${item.name}</strong>
        <div class="small">${date(item.createdAt)}</div>
        <p>${item.message}</p>
        ${item.reply ? `<div class="comment-item" style="margin-top:10px"><strong>رد المطور — ${item.reply.by || 'المطور'}</strong><div class="small">${date(item.reply.createdAt)}</div><p>${item.reply.text}</p></div>` : ''}
      </article>
    `).join('') : '<div class="comment-item"><strong>لا توجد تعليقات بعد</strong><div class="small">ابدأ بإرسال أول تعليق من النموذج أعلاه.</div></div>'
  }
  async function loadComments() {
    const { data } = await api('/api/public/comments')
    if (data.ok) renderComments(data.comments || [])
  }
  async function submitComment(e) {
    e.preventDefault()
    status('commentStatus', 'جاري الإرسال...')
    const payload = {
      name: $('commentName')?.value || '',
      contact: $('commentContact')?.value || '',
      message: $('commentMessage')?.value || '',
    }
    const { res, data } = await api('/api/public/comments', { method: 'POST', body: payload })
    if (!res.ok || !data.ok) return status('commentStatus', data.error || 'تعذر الإرسال.', 'error')
    e.currentTarget.reset()
    status('commentStatus', 'تم إرسال التعليق بنجاح.', 'success')
    await loadComments(); await loadStats()
  }
  async function submitLogin(e) {
    e.preventDefault()
    status('loginStatus', 'جاري التحقق...')
    const payload = { number: ($('loginNumber')?.value || '').replace(/\D/g, ''), password: $('loginPassword')?.value || '' }
    const { res, data } = await api('/api/panel/login', { method: 'POST', body: payload })
    if (!res.ok || !data.ok) return status('loginStatus', data.error || 'فشل تسجيل الدخول.', 'error')
    localStorage.setItem('panel_token_' + data.number, data.token)
    status('loginStatus', 'تم تسجيل الدخول، سيتم تحويلك...', 'success')
    window.location.href = '/panel/' + data.number
  }
  async function copyPairCode() {
    if (!state.rawPairCode) return
    try { await navigator.clipboard.writeText(state.rawPairCode); return true } catch { return false }
  }
  async function submitPair(e) {
    e.preventDefault()
    status('pairStatus', 'جاري تجهيز كود الاقتران...')
    $('pairResult')?.classList.add('hidden')
    const payload = {
      number: ($('pairNumber')?.value || '').replace(/\D/g, ''),
      accepted: !!$('pairAccepted')?.checked,
    }
    const { res, data } = await api('/api/public/pairing-code', { method: 'POST', body: payload })
    if (!res.ok || !data.ok) return status('pairStatus', data.error || 'تعذر إصدار الكود.', 'error')
    state.rawPairCode = String(data.rawCode || '').replace(/[^A-Za-z0-9]/g, '')
    set('pairCode', data.code || state.rawPairCode || '—')
    if ($('pairPanelLink') && data.panelUrl) $('pairPanelLink').href = data.panelUrl
    $('pairResult')?.classList.remove('hidden')
    const copied = await copyPairCode()
    status('pairStatus', copied ? 'تم إنشاء الكود ونسخه تلقائياً.' : 'تم إنشاء الكود. استخدم زر النسخ إذا لزم.', 'success')
  }
  async function init() {
    await Promise.all([loadConfig(), loadStats(), loadComments()])
    $('commentForm')?.addEventListener('submit', submitComment)
    $('loginForm')?.addEventListener('submit', submitLogin)
    $('pairForm')?.addEventListener('submit', submitPair)
    $('copyPairBtn')?.addEventListener('click', async () => {
      const copied = await copyPairCode()
      status('pairStatus', copied ? 'تم نسخ الكود.' : 'تعذر النسخ تلقائياً.', copied ? 'success' : 'warn')
    })
    setInterval(() => { loadStats().catch(() => {}); loadComments().catch(() => {}) }, 15000)
  }
  init().catch(console.error)
})()
''')

(root / 'public' / 'downloader.html').write_text(r'''<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>تنزيل الوسائط | Fares Bot</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/app-v2.css" />
  </head>
  <body>
    <div class="page-bg"><div class="orb a"></div><div class="orb b"></div><div class="grid"></div></div>
    <header class="topbar shell">
      <div class="brand"><div class="brand-badge">D</div><div><strong>Media Downloader</strong><small>TikTok و Instagram</small></div></div>
      <nav class="nav"><a class="btn btn-ghost" href="/">الرئيسية</a><a class="btn btn-primary" href="/panel">لوحة التحكم</a></nav>
    </header>
    <main class="shell panel-shell">
      <section class="section card download-card">
        <div class="section-head"><div><h1 style="margin:0">أداة تحميل الوسائط السريعة</h1><p>ألصق رابط TikTok أو Instagram العام، وسيتم تجهيز زر تحميل مباشر من داخل الموقع.</p></div></div>
        <form id="downloadForm">
          <div class="field"><span>رابط الفيديو</span><input id="mediaUrl" type="url" placeholder="https://www.tiktok.com/... أو https://www.instagram.com/reel/..." required /></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">تجهيز التنزيل</button><a class="btn btn-ghost" href="/">عودة</a></div>
          <div id="downloadStatus" class="status"></div>
        </form>
        <div id="downloadResult" class="hidden">
          <div class="kv"><span>المنصة</span><strong id="mediaPlatform">—</strong></div>
          <div class="kv"><span>العنوان</span><strong id="mediaTitle">—</strong></div>
          <div class="panel-actions" style="margin-top:16px"><a id="downloadBtn" class="btn btn-secondary" href="#">تحميل الملف الآن</a></div>
        </div>
      </section>
    </main>
    <script>
      const $ = (id) => document.getElementById(id)
      const setStatus = (text, kind='') => { const el = $('downloadStatus'); if (!el) return; el.className = `status ${kind}`.trim(); el.textContent = text || '' }
      const set = (id, text) => { const el = $(id); if (el) el.textContent = text }
      async function submitDownload(e){
        e.preventDefault();
        setStatus('جاري تجهيز رابط التحميل...');
        $('downloadResult')?.classList.add('hidden');
        const res = await fetch('/api/public/media-download', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: $('mediaUrl')?.value || '' })})
        const data = await res.json().catch(() => ({}))
        if(!res.ok || !data.ok) return setStatus(data.error || 'تعذر تجهيز التنزيل.', 'error')
        set('mediaPlatform', data.platform || 'media')
        set('mediaTitle', data.title || 'media-download')
        if ($('downloadBtn')) $('downloadBtn').href = data.downloadUrl
        $('downloadResult')?.classList.remove('hidden')
        setStatus('تم تجهيز الملف. اضغط زر التحميل قبل انتهاء صلاحية الرابط.', 'success')
      }
      $('downloadForm')?.addEventListener('submit', submitDownload)
    </script>
  </body>
</html>
''')

(root / 'public' / 'panel.html').write_text(r'''<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>لوحة التحكم | Fares Bot</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/app-v2.css" />
  </head>
  <body>
    <div class="page-bg"><div class="orb a"></div><div class="orb b"></div><div class="orb c"></div><div class="grid"></div></div>
    <header class="topbar shell">
      <div class="brand"><div class="brand-badge">P</div><div><strong>لوحة تحكم الرقم</strong><small>إدارة الحماية، الردود الذكية، سجل التفاعل، وربط الأرقام</small></div></div>
      <nav class="nav"><a class="btn btn-ghost" href="/">الرئيسية</a><a class="btn btn-secondary" href="/downloader">تنزيل الوسائط</a></nav>
    </header>

    <main class="shell panel-shell">
      <section id="loginCard" class="section card login-card">
        <div class="section-head"><div><h1 style="margin:0">تسجيل دخول الرقم المربوط</h1><p>أدخل الرقم المربوط وكلمة المرور لفتح لوحة التحكم الكاملة.</p></div></div>
        <form id="loginForm">
          <div class="field"><span>الرقم المربوط</span><input id="loginNumber" type="text" inputmode="numeric" required /></div>
          <div class="field"><span>كلمة المرور</span><input id="loginPassword" type="password" required /><div id="passwordHint" class="small"></div></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">دخول</button></div>
          <div id="loginStatus" class="status"></div>
        </form>
      </section>

      <section id="dashboard" class="hidden">
        <div class="dashboard-top">
          <div>
            <h1 style="margin:0 0 8px">لوحة الرقم <span id="headerNumber"></span></h1>
            <div class="small">الحالة: <span id="headerStatus">—</span> · إيموجي الحالة: <span id="headerEmoji">❤️</span></div>
          </div>
          <div class="panel-actions">
            <span id="tierPill" class="pill">STANDARD</span>
            <button id="saveBtn" class="btn btn-primary" type="button">حفظ الإعدادات</button>
            <button id="reloadBtn" class="btn btn-ghost" type="button">تحديث</button>
            <button id="logoutBtn" class="btn btn-danger" type="button">خروج</button>
          </div>
        </div>
        <div id="saveStatus" class="status"></div>

        <div class="dashboard-grid">
          <div class="quick-card card"><span class="small">الرصيد الحالي</span><h3 id="walletBalance">0</h3></div>
          <div class="quick-card card"><span class="small">إجمالي المستلم</span><h3 id="walletClaimed">0</h3></div>
          <div class="quick-card card"><span class="small">إجمالي المصروف</span><h3 id="walletSpent">0</h3></div>
          <div class="quick-card card"><span class="small">الاستلام القادم</span><h3 id="walletNextClaim">—</h3></div>
        </div>

        <div class="sections">
          <section class="section card">
            <div class="section-head"><div><h2>الحماية السريعة</h2><p>التحكم المباشر في الروابط، السبام، الحذف، ومشاهدة/تفاعل الحالات.</p></div><button id="claimDailyBtn" class="btn btn-secondary" type="button">طلب المكافأة اليومية</button></div>
            <div class="toggles">
              <div class="toggle"><strong>منع الروابط</strong><select data-setting="antiLink"><option>on</option><option>off</option></select></div>
              <div class="toggle"><strong>منع السبام</strong><select data-setting="antiSpam"><option>on</option><option>off</option></select></div>
              <div class="toggle"><strong>منع حذف الرسائل</strong><select data-setting="antiDelete"><option>on</option><option>off</option></select></div>
              <div class="toggle"><strong>منع حذف الرسائل الخاصة</strong><select data-setting="antiDeleteMessages"><option>on</option><option>off</option></select></div>
              <div class="toggle"><strong>مشاهدة الحالة تلقائياً</strong><select data-setting="autoStatusRead"><option>on</option><option>off</option></select></div>
              <div class="toggle"><strong>التفاعل مع الحالة تلقائياً</strong><select data-setting="autoStatusReact"><option>on</option><option>off</option></select></div>
            </div>
            <div id="walletStatus" class="status"></div>
          </section>

          <div class="reaction-grid two-col">
            <section class="section card">
              <div class="section-head"><div><h2>الردود الذكية</h2><p>تحديد النطاق وإضافة الردود حسب الكلمات المفتاحية.</p></div></div>
              <div class="settings-grid" style="grid-template-columns:repeat(2,1fr)">
                <div class="field"><span>نطاق الرد الذكي</span><select data-setting="aiReplyScope"><option>inbox</option><option>groups</option><option>both</option></select></div>
                <div class="field"><span>نطاق التفاعل التلقائي</span><select data-setting="autoReactScope"><option>inbox</option><option>groups</option><option>both</option></select></div>
              </div>
              <div class="field"><span>الردود المخصصة</span><textarea data-setting="customAutoReplies" placeholder="مرحبا:أهلاً بك&#10;سعر:راجع المطور"></textarea></div>
            </section>

            <section class="section card">
              <div class="section-head"><div><h2>مؤشر التفاعل مع الحالات</h2><p>سيظهر هنا آخر تفاعل ناجح وتحديثات السجل.</p></div></div>
              <div id="reactionIndicator" class="pill offline">لا يوجد تفاعل حديث</div>
              <div class="small" id="reactionLatest">—</div>
              <div id="reactionList" class="reaction-list" style="margin-top:16px"></div>
            </section>
          </div>

          <section class="section card">
            <div class="section-head"><div><h2>الإعدادات العامة</h2><p>الاسم، البادئة، الإيموجي، كلمات الحظر، والخيارات الأساسية.</p></div></div>
            <div class="settings-grid">
              <div class="field"><span>اسم البوت</span><input data-setting="name" /></div>
              <div class="field"><span>اسم المالك</span><input data-setting="ownername" /></div>
              <div class="field"><span>رقم المالك</span><input data-setting="ownerNumber" /></div>
              <div class="field"><span>البادئة</span><input data-setting="prefix" /></div>
              <div class="field"><span>الوضع</span><select data-setting="mode"><option>private</option><option>public</option><option>group</option><option>inbox</option><option>self</option></select></div>
              <div class="field"><span>إيموجي تفاعل الحالة</span><input data-setting="statusCustomReact" placeholder="❤️,🔥,👍" /></div>
              <div class="field"><span>الروابط المحظورة</span><input data-setting="antiLinkList" /></div>
              <div class="field"><span>الكلمات الممنوعة</span><input data-setting="antiBadWords" /></div>
              <div class="field"><span>رسالة Alive</span><input data-setting="aliveMsg" /></div>
            </div>
          </section>

          <section class="section card">
            <div class="section-head"><div><h2>المحفظة والمتجر</h2><p>استلام العملات وشراء المزايا المشروعة داخل المشروع.</p></div></div>
            <div id="activeFeatures" class="reaction-list"></div>
            <div id="storeOffers" class="offer-grid" style="margin-top:16px"></div>
            <div id="storeStatus" class="status"></div>
          </section>

          <section class="section card">
            <div class="section-head"><div><h2>ربط رقم جديد</h2><p>إصدار كود اقتران لرقم آخر دون التأثير على الجلسة الحالية.</p></div></div>
            <form id="pairForm">
              <div class="field"><span>رقم الهدف</span><input id="pairTarget" type="text" inputmode="numeric" required /></div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">إصدار كود</button></div>
              <div id="pairStatus" class="status"></div>
            </form>
            <div id="pairResult" class="hidden"><div class="kv"><span>الكود</span><strong id="pairCode">—</strong></div></div>
          </section>

          <section class="section card">
            <div class="section-head"><div><h2>تغيير كلمة المرور</h2><p>كلمة المرور تخص هذا الرقم فقط.</p></div></div>
            <form id="passwordForm">
              <div class="two-col">
                <div class="field"><span>كلمة المرور الحالية</span><input id="currentPassword" type="password" required /></div>
                <div class="field"><span>كلمة المرور الجديدة</span><input id="newPassword" type="password" minlength="4" required /></div>
              </div>
              <div class="form-actions"><button class="btn btn-secondary" type="submit">تحديث كلمة المرور</button></div>
              <div id="passwordStatus" class="status"></div>
            </form>
          </section>
        </div>
      </section>
    </main>

    <script src="/panel.js"></script>
  </body>
</html>
''')

(root / 'public' / 'panel.js').write_text(r'''(() => {
  const state = { number: '', token: '', settings: {}, wallet: null }
  const $ = (id) => document.getElementById(id)
  const $$ = (sel) => Array.from(document.querySelectorAll(sel))
  const fmt = (n) => new Intl.NumberFormat('ar').format(Number(n || 0))
  const date = (v) => v ? new Date(v).toLocaleString('ar') : '—'
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value }
  const setStatus = (id, text, kind='') => { const el = $(id); if (!el) return; el.className = `status ${kind}`.trim(); el.textContent = text || '' }
  async function api(url, options={}) {
    const opts = { method: 'GET', headers: {}, ...options }
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(opts.body)
    }
    if (state.token) opts.headers['x-panel-token'] = state.token
    const res = await fetch(url, opts)
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }
  function pathNumber() {
    const m = (location.pathname || '').match(/\/panel\/(\d+)/)
    return m ? m[1] : ''
  }
  function readSettings() {
    const out = {}
    $$('[data-setting]').forEach((el) => { out[el.dataset.setting] = el.value })
    return out
  }
  function writeSettings(settings={}) {
    state.settings = settings
    $$('[data-setting]').forEach((el) => {
      const key = el.dataset.setting
      el.value = settings[key] ?? el.value ?? ''
    })
    setText('headerEmoji', settings.statusCustomReact || '❤️')
  }
  function renderWallet(wallet) {
    state.wallet = wallet
    setText('walletBalance', fmt(wallet.balance))
    setText('walletClaimed', fmt(wallet.totalClaimed))
    setText('walletSpent', fmt(wallet.totalSpent))
    setText('walletNextClaim', wallet.canClaimDaily ? 'متاح الآن' : `${Math.ceil((wallet.remainingMs || 0)/60000)} دقيقة`)
    const tier = $('tierPill')
    if (tier) {
      tier.textContent = wallet.tier || 'STANDARD'
      tier.className = 'pill' + ((wallet.tier || '').toLowerCase() === 'vip' ? '' : '')
    }
    const features = $('activeFeatures')
    if (features) {
      const items = wallet.activeFeatures || []
      features.innerHTML = items.length ? items.map(i => `<div class="active-chip"><strong>${i.title}</strong><div class="small">ينتهي: ${date(i.activeUntil)}</div></div>`).join('') : '<div class="active-chip"><strong>لا توجد مزايا مفعلة</strong><div class="small">يمكن شراء ميزة من المتجر أدناه.</div></div>'
    }
  }
  function renderStore(store=[]) {
    const wrap = $('storeOffers'); if (!wrap) return
    wrap.innerHTML = store.map(item => `
      <article class="offer ${item.active ? 'active' : ''}">
        <div class="eyebrow">${item.key}</div>
        <h3>${item.title}</h3>
        <div class="price">${fmt(item.price)} عملة</div>
        <p class="small">${item.description}</p>
        <div class="small">${item.active ? `مفعلة حتى ${date(item.activeUntil)}` : 'غير مفعلة'}</div>
        <div class="panel-actions" style="margin-top:12px"><button class="btn ${item.active ? 'btn-ghost' : 'btn-secondary'} buy-btn" data-offer="${item.key}" ${item.active ? 'disabled' : ''}>${item.active ? 'مفعلة' : 'شراء الآن'}</button></div>
      </article>`).join('')
    $$('.buy-btn').forEach(btn => btn.addEventListener('click', () => buyOffer(btn.dataset.offer)))
  }
  function renderReactions(stateData={}) {
    const active = stateData.indicator === 'active'
    const pill = $('reactionIndicator')
    if (pill) {
      pill.textContent = active ? 'التفاعل ظاهر الآن باللون الأخضر' : 'لا يوجد تفاعل حديث'
      pill.className = 'pill' + (active ? '' : ' offline')
    }
    const latest = stateData.latestReaction
    setText('reactionLatest', latest ? `${latest.emoji} · ${latest.participantLabel || latest.participantNumber || '—'} · ${date(latest.reactedAt)}` : '—')
    const wrap = $('reactionList')
    if (!wrap) return
    const logs = stateData.logs || []
    wrap.innerHTML = logs.length ? logs.slice(0, 8).map(item => `<div class="reaction-item"><strong>${item.emoji} ${item.participantLabel || item.participantNumber || 'غير معروف'}</strong><div class="small">${date(item.reactedAt)}</div></div>`).join('') : '<div class="reaction-item"><strong>لا يوجد سجل بعد</strong><div class="small">سيظهر هنا أول تفاعل ناجح على الحالات.</div></div>'
  }
  async function loadDefaultsHint(number) {
    try {
      const { data } = await api(`/api/panel/${encodeURIComponent(number)}/default-password`)
      if (data.ok) setText('passwordHint', data.hasCustomPassword ? 'تم تعيين كلمة مرور مخصصة لهذا الرقم.' : `كلمة المرور الافتراضية: ${data.defaultPassword}`)
    } catch {}
  }
  async function loadAll() {
    const settingsReq = api(`/api/panel/${encodeURIComponent(state.number)}/settings`)
    const walletReq = api(`/api/panel/${encodeURIComponent(state.number)}/wallet`)
    const reactionsReq = api(`/api/panel/${encodeURIComponent(state.number)}/status-reactions`)
    const [{ data: settingsData }, { data: walletData }, { data: reactionData }] = await Promise.all([settingsReq, walletReq, reactionsReq])
    if (!settingsData.ok) throw new Error(settingsData.error || 'تعذر تحميل الإعدادات.')
    if (!walletData.ok) throw new Error(walletData.error || 'تعذر تحميل المحفظة.')
    if (!reactionData.ok) throw new Error(reactionData.error || 'تعذر تحميل التفاعلات.')
    writeSettings(settingsData.settings || {})
    renderWallet(walletData.wallet || {})
    renderStore(walletData.store || [])
    renderReactions(reactionData.reactions || {})
    setText('headerNumber', settingsData.number || state.number)
    setText('headerStatus', settingsData.status || '—')
    setText('headerEmoji', settingsData.emoji || '❤️')
    $('loginCard')?.classList.add('hidden')
    $('dashboard')?.classList.remove('hidden')
  }
  async function doLogin(e) {
    e.preventDefault()
    setStatus('loginStatus', 'جاري تسجيل الدخول...')
    const number = ($('loginNumber')?.value || '').replace(/\D/g, '')
    const password = $('loginPassword')?.value || ''
    const { res, data } = await api('/api/panel/login', { method: 'POST', body: { number, password } })
    if (!res.ok || !data.ok) return setStatus('loginStatus', data.error || 'فشل تسجيل الدخول.', 'error')
    state.number = data.number
    state.token = data.token
    localStorage.setItem('panel_token_' + data.number, data.token)
    history.replaceState({}, '', '/panel/' + data.number)
    await loadAll()
    setStatus('loginStatus', 'تم تسجيل الدخول.', 'success')
  }
  async function saveSettings() {
    setStatus('saveStatus', 'جاري حفظ الإعدادات...')
    const { res, data } = await api(`/api/panel/${encodeURIComponent(state.number)}/settings`, { method: 'POST', body: { settings: readSettings() } })
    if (!res.ok || !data.ok) return setStatus('saveStatus', data.error || 'فشل الحفظ.', 'error')
    writeSettings(data.settings || {})
    setStatus('saveStatus', 'تم حفظ الإعدادات بنجاح.', 'success')
  }
  async function claimDaily() {
    setStatus('walletStatus', 'جاري طلب المكافأة اليومية...')
    const { res, data } = await api(`/api/panel/${encodeURIComponent(state.number)}/claim-daily`, { method: 'POST', body: {} })
    if (!res.ok || !data.ok) return setStatus('walletStatus', data.error || 'تعذر الاستلام.', 'error')
    renderWallet(data.wallet || {})
    setStatus('walletStatus', `تمت إضافة ${data.amount} عملة إلى الرصيد.`, 'success')
  }
  async function buyOffer(key) {
    setStatus('storeStatus', 'جاري تنفيذ الشراء...')
    const { res, data } = await api(`/api/panel/${encodeURIComponent(state.number)}/store/buy`, { method: 'POST', body: { offerKey: key } })
    if (!res.ok || !data.ok) return setStatus('storeStatus', data.error || 'فشل الشراء.', 'error')
    renderWallet(data.result.wallet || {})
    const walletRefresh = await api(`/api/panel/${encodeURIComponent(state.number)}/wallet`)
    if (walletRefresh.data.ok) renderStore(walletRefresh.data.store || [])
    setStatus('storeStatus', `تم شراء ${data.result.offer.title} بنجاح.`, 'success')
  }
  async function pairNumber(e) {
    e.preventDefault()
    setStatus('pairStatus', 'جاري إصدار الكود...')
    const target = ($('pairTarget')?.value || '').replace(/\D/g, '')
    const { res, data } = await api(`/api/panel/${encodeURIComponent(state.number)}/pair`, { method: 'POST', body: { number: target } })
    if (!res.ok || !data.ok) return setStatus('pairStatus', data.error || 'تعذر إصدار الكود.', 'error')
    setText('pairCode', data.code || data.rawCode || '—')
    $('pairResult')?.classList.remove('hidden')
    try { if (data.rawCode) await navigator.clipboard.writeText(String(data.rawCode).replace(/[^A-Za-z0-9]/g,'')) } catch {}
    setStatus('pairStatus', 'تم إصدار الكود ونسخه تلقائياً إن أمكن.', 'success')
  }
  async function changePassword(e) {
    e.preventDefault()
    setStatus('passwordStatus', 'جاري تحديث كلمة المرور...')
    const body = { currentPassword: $('currentPassword')?.value || '', newPassword: $('newPassword')?.value || '' }
    const { res, data } = await api(`/api/panel/${encodeURIComponent(state.number)}/password`, { method: 'POST', body })
    if (!res.ok || !data.ok) return setStatus('passwordStatus', data.error || 'فشل تحديث كلمة المرور.', 'error')
    $('passwordForm')?.reset(); setStatus('passwordStatus', 'تم تحديث كلمة المرور.', 'success')
  }
  async function logout() {
    try { await api('/api/panel/logout', { method: 'POST', body: {} }) } catch {}
    localStorage.removeItem('panel_token_' + state.number)
    state.token = ''; state.number = ''
    history.replaceState({}, '', '/panel')
    $('dashboard')?.classList.add('hidden')
    $('loginCard')?.classList.remove('hidden')
  }
  async function bootstrap() {
    $('loginForm')?.addEventListener('submit', doLogin)
    $('saveBtn')?.addEventListener('click', saveSettings)
    $('reloadBtn')?.addEventListener('click', () => loadAll().catch(err => setStatus('saveStatus', err.message, 'error')))
    $('logoutBtn')?.addEventListener('click', logout)
    $('claimDailyBtn')?.addEventListener('click', claimDaily)
    $('pairForm')?.addEventListener('submit', pairNumber)
    $('passwordForm')?.addEventListener('submit', changePassword)
    const number = pathNumber()
    if (number) {
      $('loginNumber').value = number
      await loadDefaultsHint(number)
      const saved = localStorage.getItem('panel_token_' + number)
      if (saved) {
        state.number = number; state.token = saved
        try { await loadAll() } catch { await logout() }
      }
    }
    setInterval(() => { if (state.number && state.token) { loadAll().catch(() => {}) } }, 20000)
  }
  bootstrap().catch(console.error)
})()
''')

print('Updated files successfully')
