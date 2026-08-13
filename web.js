const express = require('express')
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

  // تعليقات عربية تجريبية متنوعة: تعليق جديد كل دقيقة مع رد تلقائي مطابق.
  if (!global.__faresAutoCommentTimer) {
    global.__faresAutoCommentTimer = setInterval(() => {
      try { db.addAutomaticComment() } catch (e) { console.warn('[auto-comment]', e.message) }
    }, 60 * 1000)
  }

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
