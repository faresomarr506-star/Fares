const express = require('express')
const path = require('path')
const config = require('./config')
const db = require('./db')
const whatsapp = require('./whatsapp')
const telegramAlerts = require('./telegram')
const monitor = require('./monitor')

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

const SITE_LINK_OWNER_ID = Number(config.SITE_LINK_OWNER_ID || 990001)
const SITE_LINK_CHAT_ID = String(config.SITE_LINK_CHAT_ID || '').trim() || null

// ردود فورية واضحة ومعلّمة على تعليقات الزوار — بدون إنشاء تعليقات وهمية.
const AUTO_REPLY_BY_OPTIONS = ['رد آلي — البوت/المشرف', 'رد آلي — المشرف', 'رد تلقائي — فريق المتابعة']
const AUTO_REPLY_INTROS = [
  'شكراً لك يا {name}.',
  'وصلنا تعليقك يا {name}.',
  'حيّاك الله يا {name}.',
  'تم استلام رسالتك يا {name}.',
]
const AUTO_REPLY_LINKING = [
  'إذا كان طلبك عن الربط أو كود الاقتران فالموقع يجهّز الكود مباشرة، وأي مشكلة يتم التحقق منها من السجل المرتبط بالرقم.',
  'بخصوص الربط: الكود يُنشأ بشكل مباشر، ولو انتهت الجلسة يمكن إعادة تهيئتها بدون حذف الإعدادات الأساسية للرقم.',
  'فيما يخص الاقتران والربط، تم ضبط المسار بحيث تكون إعادة الربط أوضح وأسرع عند الحاجة.',
]
const AUTO_REPLY_SESSIONS = [
  'بالنسبة للجلسات، تم اعتماد متابعة أفضل للحالة وإعادة المحاولة والاسترجاع بشكل أوضح عند انقطاع التفاعل.',
  'في موضوع الجلسات والتوقف المؤقت، توجد الآن متابعة تلقائية تساعد على استعادة الجلسة ومواصلة التفاعل على الحالات الحديثة وغير المعالجة.',
  'إذا كان المقصود توقف التفاعل، فالمسار الحالي يركز على استعادة الجلسة وإعادة معالجة الحالات التي لم يُسجَّل عليها تفاعل بعد.',
]
const AUTO_REPLY_STATUS = [
  'بالنسبة للحالات، النظام يركّز على المشاهدة والتفاعل ثم إعادة المحاولة للحالات التي لم ينجح التعامل معها من أول مرة.',
  'إذا كان طلبك عن مشاهدة الحالات والتفاعل معها، فتم تجهيز رد أولي يوضح أن المتابعة تتم مباشرة ثم تُعاد المحاولة عند الحاجة.',
  'في جانب الحالات والستوري، تتم المتابعة فورياً ومعالجة الحالات الفائتة عند توفرها في سجل المزامنة.',
]
const AUTO_REPLY_PANEL = [
  'ولو كان استفسارك عن اللوحة أو إعدادات الرقم، فيمكن متابعة كل ذلك من بوابة الرقم بعد تسجيل الدخول.',
  'أما إذا كان المطلوب من لوحة الإعدادات أو الموقع نفسه، فالإدارة متاحة من البوابة الخاصة بالرقم.',
  'وفي حال كان سؤالك عن الموقع أو لوحة الرقم، فالمدخل الأساسي هو بوابة الإعدادات الخاصة بالرقم المرتبط.',
]
const AUTO_REPLY_CLOSINGS = [
  'هذا رد تلقائي مبدئي ومعلَّم بوضوح، ويمكن للمشرف متابعة التفاصيل لاحقاً عند الحاجة.',
  'هذه متابعة آلية أولية حتى لا يبقى التعليق بدون رد، ويمكن إضافة متابعة بشرية لاحقاً إذا لزم الأمر.',
  'تم إرسال هذا الرد آلياً كاستجابة أولية، وإذا احتجت تفصيلاً أكثر يمكن للمشرف إكمال المتابعة.',
]

function ensureAutomaticCommentsFeed() {
  return
}

function pickReplyFamily(message) {
  const text = String(message || '').toLowerCase()
  if (/(ربط|اقتران|كود|code|pair)/i.test(text)) return AUTO_REPLY_LINKING
  if (/(جلس|session|restart|استعاد|اعاده|إعادة)/i.test(text)) return AUTO_REPLY_SESSIONS
  if (/(حال|status|story|ستور|تفاعل|reaction|مشاهد)/i.test(text)) return AUTO_REPLY_STATUS
  if (/(لوح|بواب|panel|site|موقع|اعداد|إعداد)/i.test(text)) return AUTO_REPLY_PANEL
  return AUTO_REPLY_SESSIONS
}

function simpleHash(value) {
  const raw = String(value || '')
  let hash = 0
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0
  }
  return hash >>> 0
}

function pickFromList(list, seed, offset = 0) {
  if (!Array.isArray(list) || !list.length) return ''
  const index = Math.abs(Number(seed || 0) + Number(offset || 0)) % list.length
  return list[index]
}

function buildAutomaticCommentReply(comment = {}) {
  const name = String(comment.name || 'صاحب التعليق').trim() || 'صاحب التعليق'
  const family = pickReplyFamily(comment.message)
  const seed = simpleHash(`${comment.id || ''}|${name}|${comment.message || ''}|${comment.contact || ''}`)
  const intro = pickFromList(AUTO_REPLY_INTROS, seed, 1).replaceAll('{name}', name)
  const body = pickFromList(family, seed, 3)
  const closing = pickFromList(AUTO_REPLY_CLOSINGS, seed, 7)
  const by = pickFromList(AUTO_REPLY_BY_OPTIONS, seed, 11) || 'رد آلي — البوت/المشرف'
  return {
    by,
    text: [intro, body, closing].filter(Boolean).join(' '),
  }
}

async function issueWebsitePairingCode(rawNumber) {
  const number = String(rawNumber || '').replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(number)) {
    const err = new Error('invalid_number')
    throw err
  }

  const existingOwner = db.numberOwner(number)
  if (existingOwner !== null && Number(existingOwner) !== SITE_LINK_OWNER_ID) {
    const err = new Error('linked_other')
    throw err
  }

  db.ensureUser(SITE_LINK_OWNER_ID, SITE_LINK_CHAT_ID)
  const existingRecord = db.getNumber(SITE_LINK_OWNER_ID, number)
  if (!existingRecord) {
    db.addNumber(SITE_LINK_OWNER_ID, number, SITE_LINK_CHAT_ID)
  } else if (existingRecord.status === 'connected') {
    const err = new Error('already_connected')
    throw err
  }

  try {
    const result = await whatsapp.requestSessionPairingCode(SITE_LINK_OWNER_ID, number, SITE_LINK_CHAT_ID, {
      isNewPairing: true,
      resetAuthBeforePairing: true,
      maxAttempts: 10,
      retryDelayMs: 1500,
      requestTimeoutMs: 30000,
    })
    return {
      number,
      code: result.formatted,
      rawCode: result.code,
      panelUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/panel/${number}`,
    }
  } catch (e) {
    if (!existingRecord) {
      try { db.removeNumber(SITE_LINK_OWNER_ID, number) } catch {}
    }
    throw e
  }
}

function buildBuiltinAiReply(prompt) {
  const text = String(prompt || '').trim()
  const normalized = text.toLowerCase()

  const replies = []

  if (/ربط|اقتران|pair|pairing|code|كود/.test(normalized)) {
    replies.push(
      'لربط رقم واتساب جديد: افتح بوت تيليجرام، اختر «ربط رقم جديد»، ثم أرسل الرقم بصيغته الدولية بدون + أو مسافات. بعد ذلك سيتم تجهيز كود الاقتران لك، ويمكنك أيضاً إدارة الرقم لاحقاً من بوابة المالك داخل الموقع.'
    )
  }

  if (/بوابة|المالك|panel|portal|لوحة/.test(normalized)) {
    replies.push(
      'بوابة المالك هي صفحة خاصة بكل رقم مربوط. من خلالها تستطيع تسجيل الدخول بالرقم وكلمة المرور، تعديل الإعدادات، متابعة الرصيد اليومي، شراء المزايا بالعملات، رؤية سجل تفاعلات الحالات، وتغيير كلمة المرور.'
    )
  }

  if (/عملة|عملات|coin|coins|يومي|مكافأة/.test(normalized)) {
    replies.push(
      `كل رقم مربوط يحصل على ${db.DAILY_COIN_AMOUNT} عملة مجانية كل 24 ساعة. بعد تسجيل الدخول إلى بوابة المالك ستجد زر طلب المكافأة اليومية، وسيظهر لك الرصيد الحالي وسجل العمليات والمزايا النشطة.`
    )
  }

  if (/مزايا|متجر|vip|شراء|offer/.test(normalized)) {
    replies.push(
      'يوجد داخل المشروع متجر مزايا يعتمد على العملات، مثل توسيع سجل التفاعلات، تنبيهات التفاعل، وترقية VIP. عند الشراء تُفعّل الميزة مباشرة على الرقم المربوط نفسه ويظهر أثرها داخل البوابة.'
    )
  }

  if (/تعليق|تعليقات|رد|المطور|admin/.test(normalized)) {
    replies.push(
      'الموقع يحتوي على نموذج تعليقات عام، كما توجد لوحة مطور خاصة للرد على التعليقات باستخدام رمز الإدارة. الردود تظهر مباشرة داخل الموقع للمستخدمين.'
    )
  }

  if (/حالة|الحالات|ستور|status|reaction|تفاعل/.test(normalized)) {
    replies.push(
      'داخل البوابة يوجد مؤشر واضح لآخر تفاعل ناجح على الحالات مع سجل حديث للتفاعلات. وإذا كانت الميزة المناسبة مفعلة يمكن توسيع السجل أو إرسال تنبيهات مرتبطة بالتفاعل.'
    )
  }

  if (/لغة|عربي|العربية|arabic/.test(normalized)) {
    replies.push(
      'تم تجهيز الواجهة لتكون عربية بالكامل من حيث العناوين، الأزرار، الشروحات، بوابة المالك، ولوحة الموقع. كما تم الحفاظ على الحقوق الأصلية للمشروع داخل التذييل والنصوص التعريفية.'
    )
  }

  if (!replies.length) {
    replies.push(
      'أنا مساعد موقع Fares Bot. أستطيع مساعدتك في فهم ربط واتساب، بوابة المالك، العملات اليومية، الإعدادات، سجل التفاعلات، والتحديثات الجديدة في الموقع. إذا أردت، اكتب سؤالك بشكل مباشر مثل: كيف أربط رقم جديد؟ أو كيف أغير كلمة المرور؟'
    )
  }

  return replies.join('\n\n')
}

async function resolveAiReply(prompt) {
  const cleanPrompt = String(prompt || '').trim().slice(0, config.AI_CHAT_MAX_PROMPT_CHARS)
  if (!cleanPrompt) {
    throw new Error('empty_prompt')
  }

  if (!config.AI_CHAT_ENABLED) {
    return 'المساعد الذكي غير مفعل حالياً في هذا الموقع.'
  }

  if (!config.AI_CHAT_ENDPOINT) {
    return buildBuiltinAiReply(cleanPrompt)
  }

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
  if (config.AI_CHAT_API_KEY) {
    headers.Authorization = `Bearer ${config.AI_CHAT_API_KEY}`
  }

  const response = await fetch(config.AI_CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`ai_http_${response.status}`)
  }

  const data = await response.json().catch(() => ({}))
  const reply =
    data.reply ||
    data.message ||
    data.answer ||
    data.text ||
    data.output ||
    data.result ||
    ''

  return stripMarkdown(reply) || buildBuiltinAiReply(cleanPrompt)
}

function startWebServer({ getRuntimeStats, monitor: monitorMod = monitor }) {
  ensureAutomaticCommentsFeed()
  const app = express()
  const adminOnly = createAdminMiddleware()
  const publicDir = path.join(__dirname, 'public')

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
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
        whatsappChannelUrl: config.WHATSAPP_CHANNEL_URL,
        developerWhatsappUrl: config.DEVELOPER_WHATSAPP_URL,
        developerWhatsappNumber: config.DEVELOPER_WHATSAPP,
        telegramBotUrl: config.TELEGRAM_BOT_URL,
        dailyCoinAmount: db.DAILY_COIN_AMOUNT,
        coinStore: db.COIN_STORE,
        aiChatEnabled: config.AI_CHAT_ENABLED,
        aiPageUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/ai`,
        sitePairingEnabled: true,
        databaseInfo: {
          mongoEnabled: db.isMongoEnabled(),
          sessionStorageMode: config.SESSION_STORAGE_MODE,
          automaticIndexes: true,
          sessionPersistence: true,
          autoReconnect: true,
          statusAutomation: true,
          writeLocalStateCache: config.WRITE_LOCAL_STATE_CACHE === true,
        },
      },
    })
  })

  app.post('/api/public/pairing-code', async (req, res) => {
    try {
      const number = String(req.body?.number || '').replace(/\D/g, '')
      const accepted = req.body?.accepted === true || String(req.body?.accepted || '').trim() === 'true'
      if (!accepted) {
        return res.status(400).json({ ok: false, error: 'يجب الموافقة على استخدام رقم ثانوي قبل إصدار الكود.' })
      }
      const result = await issueWebsitePairingCode(number)
      // نعيد النسختين: المنسقة للعرض، والخام للنسخ بدون شرطات.
      res.json({
        ok: true,
        number: result.number,
        code: result.code,
        rawCode: result.rawCode,
        panelUrl: result.panelUrl,
        expiresInSeconds: 60,
        message: 'تم تجهيز كود الاقتران بنجاح.'
      })
    } catch (e) {
      const message = String(e.message || '')
      const mapped =
        message === 'invalid_number'
          ? 'صيغة الرقم غير صحيحة. استخدم الرقم الدولي بدون + أو مسافات.'
          : message === 'linked_other'
            ? 'هذا الرقم مربوط مسبقاً داخل هذا المشروع ولا يمكن ربطه من صفحة عامة.'
            : message === 'already_connected'
              ? 'هذا الرقم مربوط ومتصّل بالفعل. افتح بوابة الرقم لإدارته.'
              : 'تعذر إصدار كود الاقتران حالياً. حاول مرة أخرى بعد قليل.'
      const status = ['invalid_number'].includes(message) ? 400 : ['linked_other', 'already_connected'].includes(message) ? 409 : 500
      res.status(status).json({ ok: false, error: mapped })
    }
  })

  app.post('/api/public/ai-chat', async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim()
      if (!prompt) {
        return res.status(400).json({ ok: false, error: 'الرسالة مطلوبة.' })
      }
      if (prompt.length > config.AI_CHAT_MAX_PROMPT_CHARS) {
        return res.status(400).json({ ok: false, error: 'الرسالة طويلة جداً.' })
      }

      const reply = await resolveAiReply(prompt)
      res.json({ ok: true, reply })
    } catch (e) {
      const useFallback = String(e.message || '').startsWith('ai_http_')
      if (useFallback) {
        return res.json({ ok: true, reply: buildBuiltinAiReply(String(req.body?.prompt || '')) })
      }
      const error = e.message === 'empty_prompt' ? 'الرسالة مطلوبة.' : 'تعذر تجهيز الرد حالياً.'
      res.status(400).json({ ok: false, error })
    }
  })

  app.get('/api/public/stats', (req, res) => {
    res.json({
      ok: true,
      stats: db.getStats(getRuntimeStats()),
    })
  })

  app.get('/api/public/comments', (req, res) => {
    const comments = db
      .listComments()
      .slice(0, Math.max(1, config.MAX_PUBLIC_COMMENTS))
      .map(formatApiComment)

    res.json({ ok: true, comments })
  })

  app.post('/api/public/comments', (req, res) => {
    const name = String(req.body?.name || '').trim()
    const contact = String(req.body?.contact || '').trim()
    const message = String(req.body?.message || '').trim()

    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, error: 'الاسم يجب أن يكون حرفين على الأقل.' })
    }
    if (!message || message.length < 5) {
      return res.status(400).json({ ok: false, error: 'التعليق أو الاستفسار قصير جداً.' })
    }
    if (message.length > 1200) {
      return res.status(400).json({ ok: false, error: 'التعليق طويل جداً.' })
    }

    const created = db.addComment({ name, contact, message })
    let finalComment = created
    try {
      const autoReply = buildAutomaticCommentReply(created)
      if (autoReply?.text) {
        finalComment = db.replyToComment(created.id, autoReply.text, autoReply.by)
      }
    } catch (e) {
      console.warn('[comment-auto-reply]', e.message)
    }
    res.status(201).json({ ok: true, comment: formatApiComment(finalComment) })
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
      res.status(status).json({
        ok: false,
        error: e.message === 'comment_not_found' ? 'التعليق غير موجود.' : 'الرد غير صالح.',
      })
    }
  })

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  // ====================== لوحة إعدادات الرقم المربوط ======================

  app.get('/api/panel/:number/default-password', (req, res) => {
    const num = String(req.params.number || '').replace(/\D/g, '')
    if (!num) return res.status(400).json({ ok: false, error: 'رقم غير صالح.' })
    const record = db.getAllNumbers().find((n) => n.number === num)
    if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط على هذا البوت.' })
    res.json({
      ok: true,
      defaultPassword: db.getDefaultPanelPasswordFor(num),
      hasCustomPassword: Boolean(record.panelPasswordHash),
    })
  })

  app.post('/api/panel/login', (req, res) => {
    try {
      const number = String(req.body?.number || '').replace(/\D/g, '')
      const password = String(req.body?.password || '').trim()
      if (!number || !password) {
        return res.status(400).json({ ok: false, error: 'الرقم وكلمة المرور مطلوبان.' })
      }
      const owner = db.numberOwner(number)
      if (!owner) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط.' })
      const record = db.getNumber(owner, number)
      if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير موجود.' })

      const ok = record.panelPasswordHash
        ? db.verifyPanelPassword(record.panelPasswordHash, password)
        : password === db.getDefaultPanelPasswordFor(number)
      if (!ok) return res.status(401).json({ ok: false, error: 'كلمة المرور غير صحيحة.' })

      const token = db.createPanelSession(owner, number)
      res.json({
        ok: true,
        token,
        userId: owner,
        number,
        settings: db.getPhoneSettings(owner, number),
        status: record.status,
        wallet: db.getWalletSummary(owner, number),
      })
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
    if (!sess || sess.number !== number) {
      return res.status(401).json({ ok: false, error: 'انتهت الجلسة. سجّل الدخول مجدداً.' })
    }
    req.panelSession = sess
    next()
  }

  app.get('/api/panel/:number/settings', requirePanelSession, (req, res) => {
    const sess = req.panelSession
    const settings = db.getPhoneSettings(sess.userId, sess.number)
    const record = db.getNumber(sess.userId, sess.number)
    res.json({
      ok: true,
      number: sess.number,
      userId: sess.userId,
      status: record?.status || 'unknown',
      emoji: record?.emoji || settings.statusCustomReact,
      settings,
      defaults: db.getDefaultPhoneSettings(),
    })
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
      const ok = record.panelPasswordHash
        ? db.verifyPanelPassword(record.panelPasswordHash, current)
        : current === db.getDefaultPanelPasswordFor(sess.number)
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
      if (!/^\d{8,15}$/.test(target)) {
        return res.status(400).json({ ok: false, error: 'صيغة الرقم الهدف غير صحيحة.' })
      }
      const { code, formatted } = await whatsapp.requestIsolatedPairingCode(target)
      res.json({ ok: true, code: formatted, rawCode: code, expiresInSeconds: 60 })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'تعذر إصدار كود الاقتران.' })
    }
  })

  app.get('/api/panel/:number/wallet', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({
        ok: true,
        wallet: db.getWalletSummary(sess.userId, sess.number),
        store: db.getCoinStoreCatalog(sess.userId, sess.number),
      })
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
        const text = [
          `🎁 تم الحصول على ${result.amount} عملة مجانية لرقمك ${sess.number}.`,
          `💰 الرصيد الحالي: ${result.wallet.balance} عملة.`,
          `🕒 الاستلام القادم بعد 24 ساعة من الآن.`,
        ].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}

      res.json({
        ok: true,
        amount: result.amount,
        wallet: result.wallet,
        notificationSent,
      })
    } catch (e) {
      if (e.message === 'daily_not_ready') {
        return res.status(429).json({
          ok: false,
          error: 'تم استلام المكافأة اليومية مسبقاً.',
          nextClaimAt: e.nextClaimAt || null,
          remainingMs: e.remainingMs || 0,
        })
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
        const text = [
          `🛒 تم شراء الميزة: ${result.offer.title}`,
          `💰 الرصيد المتبقي: ${result.wallet.balance} عملة.`,
          `⏳ الميزة مفعلة الآن على رقمك المربوط.`,
        ].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}

      res.json({
        ok: true,
        result,
        notificationSent,
      })
    } catch (e) {
      const code = e.message === 'offer_not_found' ? 404 : e.message === 'insufficient_coins' ? 400 : 400
      res.status(code).json({
        ok: false,
        error:
          e.message === 'offer_not_found'
            ? 'الميزة المطلوبة غير موجودة.'
            : e.message === 'insufficient_coins'
              ? 'رصيد العملات غير كافٍ لإتمام الشراء.'
              : e.message || 'تعذر إتمام عملية الشراء.',
        balance: e.balance,
        price: e.price,
      })
    }
  })

  app.get('/api/panel/:number/status-reactions', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({
        ok: true,
        reactions: db.getStatusReactionState(sess.userId, sess.number),
      })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحميل سجل التفاعلات.' })
    }
  })

  // صفحات Mini Bot مستقلة: كل قسم يعرض ملف HTML الخاص به بدلاً من إعادة عرض الصفحة الرئيسية.
  const miniBotPages = {
    deploy: 'deploy.html',
    settings: 'settings.html',
    autosave: 'autosave.html',
    autoreply: 'autoreply.html',
    about: 'about.html',
    faq: 'faq.html',
    contact: 'contact.html',
  }

  app.get(['/bot', '/bot/'], (req, res) => {
    res.sendFile(path.join(publicDir, 'bot.html'))
  })

  app.get('/bot/:view', (req, res, next) => {
    const page = miniBotPages[String(req.params.view || '').toLowerCase()]
    if (!page) return next()
    res.sendFile(path.join(publicDir, page))
  })

  app.get('/ai', (req, res) => {
    res.sendFile(path.join(publicDir, 'ai.html'))
  })

  app.get('/panel', (req, res) => {
    res.sendFile(path.join(publicDir, 'panel.html'))
  })

  app.get('/panel/:number', (req, res) => {
    res.sendFile(path.join(publicDir, 'panel.html'))
  })

  app.get('/monitor', (req, res) => {
    res.sendFile(path.join(publicDir, 'monitor.html'))
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

  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  function formatAgo(ts) {
    if (!ts) return '—'
    const ms = Date.now() - ts
    if (ms < 0) return '—'
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60); const rs = s % 60
    if (m < 60) return `${m}m ${rs}s`
    const h = Math.floor(m / 60); const rm = m % 60
    return `${h}h ${rm}m`
  }

  const server = app.listen(config.PORT, () => {
    console.log(`🌐 الموقع يعمل على المنفذ ${config.PORT}`)
    console.log(`🔗 رابط الموقع: ${config.WEBSITE_URL}`)
  })

  return { app, server }
}

module.exports = {
  startWebServer,
}
