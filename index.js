const TelegramBot = require('node-telegram-bot-api')
const emojiRegex = require('emoji-regex')
const config = require('./config')
const db = require('./db')
const whatsapp = require('./whatsapp')
const web = require('./web')
const monitor = require('./monitor')

const APP_STARTED_AT = Date.now()
const pending = new Map()
let bot = null
let shuttingDown = false

function getRuntimeStats() {
  return {
    uptimeMs: Date.now() - APP_STARTED_AT,
    startedAt: APP_STARTED_AT,
    activeSessions: whatsapp.getActiveSessionsCount(),
    siteUrl: config.WEBSITE_URL,
  }
}

function isAuthorized(userId) {
  if (!config.ONLY_ADMINS) return true
  return config.ADMIN_IDS.includes(Number(userId))
}

function isDeveloper(userId) {
  return Number(userId) === Number(config.DEVELOPER_ID)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function statusText(s) {
  const map = {
    new: '🆕 جديد',
    pairing: '🔗 بانتظار كود الاقتران',
    connecting: '🔄 جاري تسجيل الدخول',
    connected: '🟢 متصل',
    logged_out: '🔴 مسجل خروجه',
  }
  return map[s] || escapeHtml(s)
}

function mainMenuKeyboard() {
  const inline_keyboard = [
    [
      { text: '➕ ربط رقم جديد', callback_data: 'link' },
      { text: '😀 تغيير إيموجي التفاعل', callback_data: 'emoji_start' },
    ],
    [
      { text: '📋 أرقامي المربوطة', callback_data: 'list' },
      { text: '⚙️ إعدادات الرقم', callback_data: 'panel_link' },
    ],
    [
      { text: '🗑 حذف رقم', callback_data: 'del_list' },
      { text: '🔑 تعديل كلمة المرور', callback_data: 'panel_pass' },
    ],
    [
      { text: '👨‍💻 مراسلة المطور', url: config.DEVELOPER_WHATSAPP_URL },
      { text: '📢 قناة الواتساب', url: config.WHATSAPP_CHANNEL_URL },
    ],
  ]

  if (config.WEBSITE_URL) {
    inline_keyboard.push([{ text: '🌐 موقع البوت', url: config.WEBSITE_URL }])
    inline_keyboard.push([{ text: '🛠 موقع إعدادات أي رقم', callback_data: 'panel_link' }])
  }

  return { reply_markup: { inline_keyboard } }
}

function buildDashboardText(userId) {
  const user = db.getUser(userId)
  const numbers = user?.numbers || []
  const intro = escapeHtml(db.getStartMessage()).trim()
  const lines = numbers.length
    ? numbers
        .map(
          (n, i) =>
            `${i + 1}. 📱 <b>${escapeHtml(n.number)}</b>\n` +
            `   😀 إيموجي التفاعل: <b>${escapeHtml(n.emoji || n.settings?.statusCustomReact || '❤️')}</b>\n` +
            `   🎛 الوضع: <b>${escapeHtml(n.settings?.mode || 'private')}</b> | البادئة: <b>${escapeHtml(n.settings?.prefix || '.')}</b>\n` +
            `   📶 الحالة: ${statusText(n.status)}\n` +
            `   📢 منضم للقناة: ${n.joinedChannel ? '✅ نعم' : '❌ لا'}\n` +
            ((config.WEBSITE_URL)
              ? `   🛠 إعدادات الرقم: ${(config.WEBSITE_URL || '').replace(/\/+$/, '')}/panel/${escapeHtml(n.number)}`
              : '')
        )
        .join('\n\n')
    : '— لا توجد أرقام مربوطة حالياً.'

  return (
    `${intro}\n\n` +
    `📋 <b>الأرقام الحالية:</b>\n${lines}\n\n` +
    `ℹ️ يمكنك تعديل إيموجي التفاعل لكل رقم وضبط الإعدادات الكاملة من موقع الإعدادات أو بأوامر المالك داخل الرقم نفسه (أرسل <code>.help</code> للرقم المربوط).\n\n` +
    `💬 <b>مراسلة المطور:</b> ${escapeHtml(config.DEVELOPER_WHATSAPP_URL)}\n` +
    `📢 <b>قناة الواتساب:</b> ${escapeHtml(config.WHATSAPP_CHANNEL_URL)}\n` +
    `🌐 <b>موقع البوت:</b> ${escapeHtml(config.WEBSITE_URL)}\n` +
    `🛠 <b>موقع إعدادات الأرقام:</b> ${escapeHtml(((config.WEBSITE_URL || '').replace(/\/+$/, '') + '/panel/'))}`
  )
}

async function showDashboard(chatId, userId, options = {}) {
  db.ensureUser(userId, chatId)
  const text = buildDashboardText(userId)
  const messageId = options.messageId || db.getDashboardMessage(userId)
  const payload = { parse_mode: 'HTML', ...mainMenuKeyboard() }

  if (messageId && !options.forceNew) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...payload,
      })
      db.setDashboardMessage(userId, messageId)
      return { message_id: messageId, edited: true }
    } catch (e) {
      const errorText = String(e.message || '')
      if (errorText.includes('message is not modified')) {
        return { message_id: messageId, edited: true }
      }
      if (
        errorText.includes('message to edit not found') ||
        errorText.includes('chat not found') ||
        errorText.includes('message can\'t be edited')
      ) {
        db.clearDashboardMessage(userId)
      } else {
        throw e
      }
    }
  }

  const sent = await bot.sendMessage(chatId, text, payload)
  db.setDashboardMessage(userId, sent.message_id)
  return sent
}

async function refreshDashboardByChat(chatId) {
  const user = db.getUserByChatId(chatId)
  if (!user) return
  try {
    await showDashboard(chatId, user.userId)
  } catch (e) {
    console.error('[تحديث الواجهة]', e.message)
  }
}

async function refreshAllDashboards() {
  const users = db.listUsers()
  for (const user of users) {
    if (!user.chatId) continue
    try {
      await showDashboard(user.chatId, user.userId)
    } catch (e) {
      console.error(`[تحديث /start ${user.userId}]`, e.message)
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

async function clearPending(chatId) {
  pending.delete(chatId)
}

async function handleStartCommand(msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  if (!isAuthorized(userId)) {
    return bot.sendMessage(chatId, '⛔ أنت غير مصرح لك باستخدام هذا البوت.').catch(() => {})
  }

  clearPending(chatId)
  db.ensureUser(userId, chatId)

  const previousDashboardMessageId = db.getDashboardMessage(userId)
  if (previousDashboardMessageId) {
    await bot.deleteMessage(chatId, String(previousDashboardMessageId)).catch(() => {})
    db.clearDashboardMessage(userId)
  }

  return showDashboard(chatId, userId, { forceNew: true }).catch((e) => {
    console.error('[/start]', e.message)
    return bot.sendMessage(chatId, '❌ حدث خطأ أثناء فتح الواجهة الرئيسية.').catch(() => {})
  })
}

async function linkNumber(chatId, userId, rawNumber) {
  const number = String(rawNumber || '').replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(number)) {
    return bot
      .sendMessage(
        chatId,
        '❌ صيغة الرقم غير صحيحة.\nأرسل الرقم بالصيغة الدولية بدون + وبدون مسافات (مثال: 9665XXXXXXXX)'
      )
      .catch(() => {})
  }

  try {
    db.addNumber(userId, number, chatId)
  } catch (e) {
    if (e.message === 'already_linked') {
      return bot.sendMessage(chatId, '⚠️ هذا الرقم مربوط بحسابك بالفعل.').catch(() => {})
    }
    if (e.message === 'linked_other') {
      return bot
        .sendMessage(
          chatId,
          '⚠️ هذا الرقم مربوط بجلسة مستخدم آخر.\nكل رقم يعمل في جلسة مستقلة ويمكن ربطه مرة واحدة فقط.'
        )
        .catch(() => {})
    }
    throw e
  }

  await showDashboard(chatId, userId).catch(() => {})

  await bot
    .sendMessage(
      chatId,
      `⏳ جاري تجهيز كود الاقتران للرقم <b>${escapeHtml(number)}</b>...\nسيصلك الكود خلال لحظات.`,
      { parse_mode: 'HTML' }
    )
    .catch(() => {})

  whatsapp.startSession(userId, number, chatId, { isNewPairing: true }).catch(async (e) => {
    console.error('[بدء الجلسة]', e.message)
    db.removeNumber(userId, number)
    await showDashboard(chatId, userId).catch(() => {})
    bot.sendMessage(chatId, '❌ تعذر بدء الجلسة: ' + escapeHtml(e.message), { parse_mode: 'HTML' }).catch(() => {})
  })
}

function registerTelegramHandlers() {
  whatsapp.setNotifier(async (chatId, text) => {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' })
    } catch (e) {
      console.error('[إشعار]', e.message)
    }
    await refreshDashboardByChat(chatId)
  })

  bot.onText(/^\/admin(?:@\w+)?(?:\s|$)/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    if (!isDeveloper(userId)) {
      return bot.sendMessage(chatId, '⛔ هذا الأمر متاح للمطور فقط.').catch(() => {})
    }

    await bot.sendMessage(
      chatId,
      `👨‍💻 <b>لوحة المطور</b>\n\n` +
        `اختر الإجراء الذي تريد تنفيذه:\n\n` +
        `• بث جماعي لكل مستخدمي البوت\n` +
        `• بث جماعي لكل الأرقام المربوطة داخل واتساب\n` +
        `• عرض إحصائيات شاملة للبوت والمستخدمين والأرقام\n` +
        `• تغيير رسالة /start مع بقاء الأزرار والأرقام الحالية والإيموجي أسفل الرسالة`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📣 بث لمستخدمي البوت', callback_data: 'adm:broadcast_user' }],
            [{ text: '📨 بث للأرقام داخل واتساب', callback_data: 'adm:broadcast_wp' }],
            [{ text: '📝 تغيير رسالة /start', callback_data: 'adm:change_start' }],
            [{ text: '♻️ استعادة الرسالة الافتراضية', callback_data: 'adm:reset_start' }],
            [{ text: '📊 إحصائيات', callback_data: 'adm:stats' }],
          ],
        },
      }
    )
  })

  bot.on('callback_query', async (q) => {
    const chatId = q.message?.chat?.id
    const userId = q.from.id
    const data = q.data || ''
    if (!chatId) return

    if (!isAuthorized(userId)) {
      return bot.answerCallbackQuery(q.id, { text: '⛔ غير مصرح' }).catch(() => {})
    }

    try {
      if (data === 'emoji_start') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const numbers = db.getUser(userId)?.numbers || []
        if (!numbers.length) {
          return bot
            .sendMessage(chatId, '⚠️ لا يوجد لديك أرقام مربوطة بعد.\nاضغط «➕ ربط رقم جديد» أولاً.')
            .catch(() => {})
        }
        const kb = numbers.map((n) => [
          {
            text: `📱 ${n.number}  ( ${n.emoji || n.settings?.statusCustomReact || '❤️'} )`,
            callback_data: `emoji:${n.number}`,
          },
        ])
        kb.push([{ text: '🔙 رجوع', callback_data: 'back' }])
        return bot
          .sendMessage(chatId, '👇 اختر الرقم الذي تريد تغيير إيموجي التفاعل الخاص به:', {
            reply_markup: { inline_keyboard: kb },
          })
          .catch(() => {})
      }

      if (data.startsWith('emoji:')) {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const number = data.slice(6)
        pending.set(chatId, { action: 'set_emoji', userId, number })
        return bot
          .sendMessage(
            chatId,
            `✍️ أرسل الآن الإيموجي الذي تريد التفاعل به على الحالات للرقم <b>${escapeHtml(number)}</b>\n\n(إيموجي واحد فقط - مثال: ❤️ 🔥 👍 😂 😮)`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
      }

      if (data === 'link') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        pending.set(chatId, { action: 'add_number', userId })
        return bot
          .sendMessage(
            chatId,
            `📲 أرسل رقم واتساب بالصيغة الدولية <b>بدون</b> + أو أصفار بادئة وبدون مسافات.\n\n` +
              `<code>مثال: 9665XXXXXXXX</code>\n\n⚠️ الرقم يجب ألا يكون مربوطاً بجلسة أخرى.`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
      }

      if (data === 'panel_link') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const numbers = db.getUser(userId)?.numbers || []
        if (!numbers.length) {
          return bot.sendMessage(chatId, '⚠️ لا يوجد لديك أرقام مربوطة.').catch(() => {})
        }
        const base = (config.WEBSITE_URL || '').replace(/\/+$/, '')
        if (!base) {
          return bot.sendMessage(chatId, '⚠️ لم يتم ضبط رابط الموقع بعد، أبلغ المطور.').catch(() => {})
        }
        const lines = numbers.map(
          (n, i) => `${i + 1}. 📱 <b>${escapeHtml(n.number)}</b>\n🛠 ${base}/panel/${escapeHtml(n.number)}`
        )
        return bot
          .sendMessage(
            chatId,
            `🛠 <b>روابط إعدادات أرقامك</b>\n\nأدخل الرقم وكلمة المرور الافتراضية (== الرقم نفسه) للدخول.\n\n${lines.join('\n\n')}`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
      }

      if (data === 'panel_pass') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const numbers = db.getUser(userId)?.numbers || []
        if (!numbers.length) {
          return bot.sendMessage(chatId, '⚠️ لا يوجد لديك أرقام مربوطة.').catch(() => {})
        }
        const kb = numbers.map((n) => [{ text: `🔑 ${n.number}`, callback_data: `pass:${n.number}` }])
        kb.push([{ text: '🔙 رجوع', callback_data: 'back' }])
        return bot
          .sendMessage(chatId, 'اختر الرقم لتغيير كلمة مرور لوحة الإعدادات الخاصة به:', {
            reply_markup: { inline_keyboard: kb },
          })
          .catch(() => {})
      }

      if (data.startsWith('pass:')) {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const number = data.slice(5)
        pending.set(chatId, { action: 'set_panel_pass', userId, number })
        return bot
          .sendMessage(
            chatId,
            `✍️ أرسل كلمة المرور الجديدة للرقم <b>${escapeHtml(number)}</b> (على الأقل 4 أحرف):`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
      }

      if (data === 'list') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const numbers = db.getUser(userId)?.numbers || []
        if (!numbers.length) {
          return bot.sendMessage(chatId, '⚠️ لا توجد أرقام مربوطة.').catch(() => {})
        }
        const lines = numbers.map(
          (n, i) =>
            `${i + 1}. 📱 <b>${escapeHtml(n.number)}</b>\n` +
            `   😀 الإيموجي: <b>${escapeHtml(n.emoji || n.settings?.statusCustomReact || '❤️')}</b> | الوضع: <b>${escapeHtml(n.settings?.mode || 'private')}</b> | البادئة: <b>${escapeHtml(n.settings?.prefix || '.')}</b>\n` +
            `   📶 الحالة: ${statusText(n.status)}\n` +
            `   📢 منضم للقناة: ${n.joinedChannel ? '✅' : '❌'}`
        )
        return bot
          .sendMessage(chatId, `📋 أرقامك المربوطة (${numbers.length}):\n\n${lines.join('\n\n')}`, {
            parse_mode: 'HTML',
          })
          .catch(() => {})
      }

      if (data === 'del_list') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const numbers = db.getUser(userId)?.numbers || []
        if (!numbers.length) {
          return bot.sendMessage(chatId, '⚠️ لا توجد أرقام لحذفها.').catch(() => {})
        }
        const kb = numbers.map((n) => [{ text: `🗑 ${n.number}`, callback_data: `del:${n.number}` }])
        kb.push([{ text: '🔙 رجوع', callback_data: 'back' }])
        return bot
          .sendMessage(chatId, 'اختر الرقم لحذفه (سيتم تسجيل الخروج من واتساب):', {
            reply_markup: { inline_keyboard: kb },
          })
          .catch(() => {})
      }

      if (data.startsWith('del:')) {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const number = data.slice(4)
        return bot
          .sendMessage(
            chatId,
            `⚠️ هل أنت متأكد من حذف الرقم <b>${escapeHtml(number)}</b>؟\nسيتم تسجيل الخروج من واتساب وحذف بيانات الجلسة نهائياً.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ نعم احذف', callback_data: `confirm_del:${number}` },
                    { text: '❌ إلغاء', callback_data: 'del_list' },
                  ],
                ],
              },
            }
          )
          .catch(() => {})
      }

      if (data.startsWith('confirm_del:')) {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        const number = data.slice(12)
        await whatsapp.stopSession(userId, number, true)
        db.removeNumber(userId, number)
        await bot
          .sendMessage(chatId, `🗑 تم حذف الرقم <b>${escapeHtml(number)}</b> وتسجيل الخروج من واتساب.`, {
            parse_mode: 'HTML',
          })
          .catch(() => {})
        await showDashboard(chatId, userId).catch(() => {})
        return
      }

      if (data === 'back') {
        await bot.answerCallbackQuery(q.id).catch(() => {})
        await showDashboard(chatId, userId, { messageId: q.message.message_id }).catch(() => {})
        return
      }

      if (data === 'adm:broadcast_user') {
        if (!isDeveloper(userId)) {
          return bot.answerCallbackQuery(q.id, { text: '⛔ للمطور فقط' }).catch(() => {})
        }
        pending.set(chatId, { action: 'broadcast_user' })
        await bot.answerCallbackQuery(q.id).catch(() => {})
        await bot
          .sendMessage(chatId, '✍️ أرسل الرسالة التي تريد بثها لجميع مستخدمي البوت عبر تيليجرام.', {
            parse_mode: 'HTML',
          })
          .catch(() => {})
        return
      }

      if (data === 'adm:broadcast_wp') {
        if (!isDeveloper(userId)) {
          return bot.answerCallbackQuery(q.id, { text: '⛔ للمطور فقط' }).catch(() => {})
        }
        pending.set(chatId, { action: 'broadcast_wp' })
        await bot.answerCallbackQuery(q.id).catch(() => {})
        await bot
          .sendMessage(chatId, '✍️ أرسل الرسالة التي تريد بثها لجميع الأرقام المربوطة داخل واتساب (DM لكل رقم).', {
            parse_mode: 'HTML',
          })
          .catch(() => {})
        return
      }

      if (data === 'adm:change_start') {
        if (!isDeveloper(userId)) {
          return bot.answerCallbackQuery(q.id, { text: '⛔ للمطور فقط' }).catch(() => {})
        }
        pending.set(chatId, { action: 'set_start_message' })
        await bot.answerCallbackQuery(q.id).catch(() => {})
        await bot
          .sendMessage(
            chatId,
            '✍️ أرسل الآن رسالة /start الجديدة.\n\nسيتم تحديث جميع رسائل /start الحالية مع بقاء الأزرار والأرقام الحالية وإيموجي التفاعل أسفل الرسالة.',
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
        return
      }

      if (data === 'adm:reset_start') {
        if (!isDeveloper(userId)) {
          return bot.answerCallbackQuery(q.id, { text: '⛔ للمطور فقط' }).catch(() => {})
        }
        db.resetStartMessage()
        await refreshAllDashboards()
        await bot.answerCallbackQuery(q.id, { text: '✅ تم استعادة الرسالة الافتراضية' }).catch(() => {})
        await bot
          .sendMessage(chatId, '✅ تم استعادة رسالة /start الافتراضية وتحديث جميع الواجهات الحالية.', {
            parse_mode: 'HTML',
          })
          .catch(() => {})
        return
      }

      if (data === 'adm:stats') {
        if (!isDeveloper(userId)) {
          return bot.answerCallbackQuery(q.id, { text: '⛔ للمطور فقط' }).catch(() => {})
        }
        const s = db.getStats(getRuntimeStats())
        const txt =
          `📊 <b>إحصائيات البوت</b>\n\n` +
          `👥 مستخدمو البوت: <b>${s.totalUsers}</b>\n` +
          `📱 إجمالي الأرقام: <b>${s.totalNumbers}</b>\n` +
          `🟢 متصلة: <b>${s.connected}</b>\n` +
          `🔄 قيد الاتصال: <b>${s.connecting}</b>\n` +
          `🔗 بانتظار كود الاقتران: <b>${s.pairing}</b>\n` +
          `🔴 مسجل خروجها: <b>${s.loggedOut}</b>\n` +
          `📢 منضمة للقناة: <b>${s.channelJoined}</b> (${s.channelJoinRate}%)\n\n` +
          `🌐 الموقع: <b>${escapeHtml(s.runtime.siteUrl || config.WEBSITE_URL)}</b>\n` +
          `⚙️ الجلسات النشطة حالياً: <b>${s.runtime.activeSessions}</b>\n` +
          `⏱ مدة التشغيل: <b>${Math.floor((s.runtime.uptimeMs || 0) / 60000)}</b> دقيقة\n\n` +
          `👁 إجمالي مشاهدات الحالات: <b>${s.metrics.totalStatusViews}</b>\n` +
          `😀 إجمالي تفاعلات الحالات: <b>${s.metrics.totalStatusReactions}</b>\n` +
          `🔐 أكواد اقتران صادرة: <b>${s.metrics.totalPairingCodesIssued}</b>\n` +
          `✅ عمليات ربط ناجحة: <b>${s.metrics.totalSuccessfulLinks}</b>\n` +
          `🔁 عمليات إعادة اتصال: <b>${s.metrics.totalReconnects}</b>\n` +
          `📩 رسائل تلقائية داخل واتساب: <b>${s.metrics.totalSelfMessages}</b>\n\n` +
          `💬 التعليقات بالموقع: <b>${s.comments.totalComments}</b>\n` +
          `🕒 بانتظار الرد: <b>${s.comments.pendingReplies}</b>\n` +
          `✅ تم الرد عليها: <b>${s.comments.repliedComments}</b>`
        await bot.sendMessage(chatId, txt, { parse_mode: 'HTML' }).catch(() => {})
        return bot.answerCallbackQuery(q.id).catch(() => {})
      }
    } catch (e) {
      console.error('[زر]', e.message)
      await bot.answerCallbackQuery(q.id, { text: '❌ حدث خطأ' }).catch(() => {})
    }
  })

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    if (!isAuthorized(userId) || !msg.text) return

    if (msg.text.startsWith('/')) {
      const parts = msg.text.trim().split(/\s+/)
      const command = (parts[0] || '').split('@')[0]

      if (command === '/start') {
        return handleStartCommand(msg)
      }

      if (command === '/add') {
        const num = (parts[1] || '').replace(/\D/g, '')
        if (!num) return bot.sendMessage(chatId, 'الاستخدام: /add 9665XXXXXXXX').catch(() => {})
        return linkNumber(chatId, userId, num)
      }

      if (command === '/remove') {
        const num = (parts[1] || '').replace(/\D/g, '')
        if (!num) return bot.sendMessage(chatId, 'الاستخدام: /remove 9665XXXXXXXX').catch(() => {})
        const owned = db.getUser(userId)?.numbers?.some((n) => n.number === num)
        if (!owned) return bot.sendMessage(chatId, '⚠️ هذا الرقم غير مربوط بحسابك.').catch(() => {})
        await whatsapp.stopSession(userId, num, true)
        db.removeNumber(userId, num)
        await bot.sendMessage(chatId, `🗑 تم حذف الرقم ${escapeHtml(num)}.`, { parse_mode: 'HTML' }).catch(() => {})
        await showDashboard(chatId, userId).catch(() => {})
        return
      }

      if (command === '/settings') {
        const num = (parts[1] || '').replace(/\D/g, '')
        if (!num) return bot.sendMessage(chatId, 'الاستخدام: /settings 9665XXXXXXXX').catch(() => {})
        const owned = db.getUser(userId)?.numbers?.some((n) => n.number === num)
        if (!owned) return bot.sendMessage(chatId, '⚠️ هذا الرقم غير مربوط بحسابك.').catch(() => {})
        const url = `${config.WEBSITE_URL || ''}/panel/${num}`.replace(/\/+$/, '')
        return bot.sendMessage(chatId, `🛠 إعدادات الرقم ${escapeHtml(num)}:\n${url}`).catch(() => {})
      }

      return
    }

    const p = pending.get(chatId)
    if (!p) return

    if (p.action === 'add_number') {
      pending.delete(chatId)
      return linkNumber(chatId, userId, msg.text)
    }

    if (p.action === 'set_emoji') {
      pending.delete(chatId)
      const m = msg.text.match(emojiRegex())
      if (!m) {
        return bot
          .sendMessage(chatId, '❌ لم أجد إيموجي في رسالتك.\nأرسل إيموجي واحد فقط (مثال: ❤️ 🔥 👍 😂 😮).')
          .catch(() => {})
      }
      try {
        const emoji = m[0]
        db.setEmoji(p.userId, p.number, emoji)
        await bot
          .sendMessage(
            chatId,
            `✅ تم حفظ الإيموجي <b>${escapeHtml(emoji)}</b> للرقم <b>${escapeHtml(p.number)}</b>.\n\n🟢 تم تطبيقه فوراً على هذا الرقم، وتم تحديث رسالة /start تلقائياً.`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
        await showDashboard(chatId, p.userId).catch(() => {})
      } catch {
        await bot.sendMessage(chatId, '❌ الرقم غير موجود في حسابك.').catch(() => {})
      }
      return
    }

    if (p.action === 'set_panel_pass') {
      pending.delete(chatId)
      const password = String(msg.text || '').trim()
      if (password.length < 4) {
        return bot.sendMessage(chatId, '❌ كلمة المرور يجب ألا تقل عن 4 أحرف.').catch(() => {})
      }
      try {
        db.setPanelPassword(p.userId, p.number, password)
        return bot
          .sendMessage(
            chatId,
            `✅ تم تحديث كلمة مرور لوحة الإعدادات للرقم <b>${escapeHtml(p.number)}</b>.`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {})
      } catch {
        return bot.sendMessage(chatId, '❌ تعذر تحديث كلمة المرور.').catch(() => {})
      }
    }

    if (p.action === 'set_start_message' && isDeveloper(userId)) {
      pending.delete(chatId)
      const message = String(msg.text || '').trim()
      if (message.length < 5) {
        return bot.sendMessage(chatId, '⚠️ رسالة /start قصيرة جداً. أرسل نصاً أوضح.').catch(() => {})
      }
      db.setStartMessage(message)
      await refreshAllDashboards()
      await bot
        .sendMessage(
          chatId,
          '✅ تم تحديث رسالة /start بنجاح، مع بقاء الأزرار والأرقام الحالية وإيموجي التفاعل أسفل الرسالة.',
          { parse_mode: 'HTML' }
        )
        .catch(() => {})
      return
    }

    if (p.action === 'broadcast_user' && isDeveloper(userId)) {
      pending.delete(chatId)
      const text = msg.text
      const chatIds = db.getAllChatIds()
      let sent = 0
      let failed = 0
      for (const cid of chatIds) {
        try {
          await bot.sendMessage(cid, text, { parse_mode: 'HTML' })
          sent++
        } catch {
          failed++
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      db.incrementMetric('totalBroadcastsTelegram', 1)
      db.incrementMetric('totalBroadcastRecipientsTelegram', sent)
      await bot
        .sendMessage(
          chatId,
          `📣 <b>تم البث لمستخدمي البوت</b>\n\n` +
            `👥 المستهدفون: <b>${chatIds.length}</b>\n` +
            `✅ تم الإرسال بنجاح: <b>${sent}</b>\n` +
            `❌ فشل: <b>${failed}</b>`,
          { parse_mode: 'HTML' }
        )
        .catch(() => {})
      return
    }

    if (p.action === 'broadcast_wp' && isDeveloper(userId)) {
      pending.delete(chatId)
      const text = msg.text
      await bot
        .sendMessage(chatId, '⏳ جاري بث الرسالة إلى الأرقام المربوطة داخل واتساب...', { parse_mode: 'HTML' })
        .catch(() => {})
      const res = await whatsapp.broadcastToWhatsapp(text)
      db.incrementMetric('totalBroadcastsWhatsapp', 1)
      db.incrementMetric('totalBroadcastRecipientsWhatsapp', res.sent)
      const detailLines = res.details
        .slice(0, 30)
        .map(
          (d) =>
            `${d.status === 'sent' ? '✅' : d.status === 'failed' ? '❌' : '⏭'} <b>${escapeHtml(d.number)}</b> — ${escapeHtml(d.status)}${d.reason ? '\n   ↳ ' + escapeHtml(d.reason) : ''}`
        )
        .join('\n')
      await bot
        .sendMessage(
          chatId,
          `📨 <b>نتيجة البث للأرقام داخل واتساب</b>\n\n` +
            `📱 المستهدفون: <b>${res.total}</b>\n` +
            `✅ تم الإرسال: <b>${res.sent}</b>\n` +
            `⏭ تم تخطيها: <b>${res.skipped}</b> (غير متصلة)\n` +
            `❌ فشل: <b>${res.failed}</b>\n\n` +
            (detailLines ? `🔎 <b>أول النتائج:</b>\n${detailLines}` : ''),
          { parse_mode: 'HTML' }
        )
        .catch(() => {})
    }
  })
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`🛑 تم استلام ${signal} — جاري إغلاق الجلسات بدون تسجيل خروج...`)

  const forceExit = setTimeout(() => {
    console.error('⏰ انتهت مهلة الإغلاق — سيتم إنهاء العملية بالقوة')
    process.exit(1)
  }, 8000)

  try {
    monitor.stop()
    await whatsapp.shutdownAll()
    await db.close()
    clearTimeout(forceExit)
    process.exit(0)
  } catch (e) {
    clearTimeout(forceExit)
    console.error('[إغلاق]', e?.message || e)
    process.exit(1)
  }
}

async function main() {
  await db.load()

  // تشغيل الموقع والربط الخارجي لا يتطلب توكن تيليجرام.
  // إذا توفر التوكن تعمل واجهة تيليجرام أيضاً، وإلا يعمل المشروع كوضع واتساب/ويب فقط.
  if (config.TELEGRAM_TOKEN) {
    bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true })
    registerTelegramHandlers()
  } else {
    console.log('ℹ️ TELEGRAM_TOKEN غير موجود — تشغيل وضع الموقع وربط واتساب فقط')
  }

  web.startWebServer({ getRuntimeStats, monitor })
  await whatsapp.resumeAll()
  if (config.ALERT_ENABLED) {
    monitor.start()
    console.log('🔔 مراقب التنبيهات يعمل')
  } else {
    console.log('🔕 مراقب التنبيهات معطل (ALERT_ENABLED=false)')
  }
  console.log('🤖 بوت التفاعل يعمل... (اضغط Ctrl+C للإيقاف)')
}

process.once('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((e) => console.error('[SIGINT]', e?.message || e))
})
process.once('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((e) => console.error('[SIGTERM]', e?.message || e))
})
process.on('uncaughtException', (e) => console.error('[خطأ عام]', e.message))
process.on('unhandledRejection', (e) => console.error('[خطأ وعد]', e?.message || e))

main().catch((e) => {
  console.error('❌ فشل تشغيل المشروع:', e?.message || e)
  process.exit(1)
})
