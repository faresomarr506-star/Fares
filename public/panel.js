(function () {
  const STATE = {
    number: '',
    token: '',
    defaults: {},
    settings: {},
    wallet: null,
    reactions: null,
    fieldMeta: {},
    refreshTimer: null,
    themeIndex: 0,
  }

  // واجهة لوحة الرقم تتبدل ألوانها كل ثانية بشكل هادئ ومنظم.
  const PANEL_PALETTES = [
    { primary: '#22d3ee', secondary: '#818cf8', tertiary: '#f472b6', accent: '#f59e0b', glow: 'rgba(34, 211, 238, 0.45)', panelPrimary: '#22d3ee', panelSecondary: '#818cf8', panelGlow: 'rgba(34, 211, 238, 0.45)' },
    { primary: '#f43f5e', secondary: '#8b5cf6', tertiary: '#22d3ee', accent: '#facc15', glow: 'rgba(244, 63, 94, 0.42)', panelPrimary: '#f43f5e', panelSecondary: '#8b5cf6', panelGlow: 'rgba(244, 63, 94, 0.42)' },
    { primary: '#14b8a6', secondary: '#3b82f6', tertiary: '#a855f7', accent: '#fb7185', glow: 'rgba(20, 184, 166, 0.42)', panelPrimary: '#14b8a6', panelSecondary: '#3b82f6', panelGlow: 'rgba(20, 184, 166, 0.42)' },
    { primary: '#f59e0b', secondary: '#ef4444', tertiary: '#6366f1', accent: '#22c55e', glow: 'rgba(245, 158, 11, 0.42)', panelPrimary: '#f59e0b', panelSecondary: '#ef4444', panelGlow: 'rgba(245, 158, 11, 0.42)' },
  ]

  function qs(id) { return document.getElementById(id) }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function setStatus(el, text, kind) {
    if (!el) return
    el.className = 'form-status ' + (kind || '')
    el.textContent = text || ''
  }

  function safeSet(id, text) {
    const el = qs(id)
    if (el) el.textContent = text
  }

  function applyPanelPalette() {
    const root = document.documentElement
    const palette = PANEL_PALETTES[STATE.themeIndex % PANEL_PALETTES.length]
    root.style.setProperty('--c-primary', palette.primary)
    root.style.setProperty('--c-primary-2', palette.secondary)
    root.style.setProperty('--c-primary-3', palette.tertiary)
    root.style.setProperty('--c-accent', palette.accent)
    root.style.setProperty('--c-glow', palette.glow)
    root.style.setProperty('--panel-p', palette.panelPrimary)
    root.style.setProperty('--panel-p2', palette.panelSecondary)
    root.style.setProperty('--panel-glow', palette.panelGlow)
  }

  function startPanelThemeCycle() {
    applyPanelPalette()
    setInterval(() => {
      STATE.themeIndex = (STATE.themeIndex + 1) % PANEL_PALETTES.length
      applyPanelPalette()
    }, 1000)
  }

  function startWithNumber() {
    const path = window.location.pathname || ''
    const match = path.match(/\/panel\/([\d]+)/)
    return match ? match[1] : ''
  }

  function formatDate(value) {
    if (!value) return '—'
    try { return new Date(value).toLocaleString('ar') } catch { return '—' }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('ar').format(Number(value || 0))
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    if (days > 0) return `${days} يوم / ${hours} ساعة`
    if (hours > 0) return `${hours} ساعة / ${minutes} دقيقة`
    return `${minutes} دقيقة`
  }

  function loadDefaults() {
    STATE.fieldMeta = {
      name: { label: 'اسم البوت', type: 'text', ph: 'Golden Queen Bot' },
      ownerNumber: { label: 'رقم التواصل', type: 'text', ph: '96777XXXXXXX' },
      ownername: { label: 'اسم المالك', type: 'text', ph: 'الاسم الكامل' },
      description: { label: 'المعلومات التعريفية', type: 'textarea', ph: 'Hi I am using Golden Queen Bot.' },
      from: { label: 'الموقع', type: 'text', ph: 'Yemen' },
      age: { label: 'العمر', type: 'text', ph: '24' },
      prefix: { label: 'البادئة', type: 'text', ph: '.' },
      footer2: { label: 'الفوتر', type: 'text', ph: 'Golden Queen Bot' },
      mode: { label: 'الوضع', type: 'select', options: ['public', 'private', 'self', 'group', 'inbox'] },
      antiBad: { label: 'مكافحة الكلمات السيئة', type: 'select', options: ['on', 'off'] },
      antiLink: { label: 'مكافحة الروابط', type: 'select', options: ['on', 'off'] },
      autoRecording: { label: 'تسجيل تلقائي', type: 'select', options: ['on', 'off'] },
      autoTyping: { label: 'كتابة تلقائية', type: 'select', options: ['on', 'off'] },
      alwaysOnline: { label: 'دائمًا أونلاين', type: 'select', options: ['on', 'off'] },
      autoStatusRead: { label: 'مشاهدة الحالة تلقائيًا', type: 'select', options: ['on', 'off'] },
      autoStatusReact: { label: 'التفاعل مع الحالة تلقائيًا', type: 'select', options: ['on', 'off'] },
      statusViewBoost: { label: 'تعزيز مشاهدة الحالة من الأرقام المربوطة', type: 'select', options: ['on', 'off'] },
      statusReactionNotice: { label: 'إظهار التفاعل لصاحب الرقم', type: 'select', options: ['on', 'off'] },
      keepDeletedStatus: { label: 'حفظ الحالة عند حذفها', type: 'select', options: ['on', 'off'] },
      saveDeletedStatusMedia: { label: 'إرسال ميديا الحالة المحذوفة', type: 'select', options: ['on', 'off'] },
      ghostMode: { label: 'تفعيل الشبح', type: 'select', options: ['on', 'off'] },
      autoPrivateReact: { label: 'التفاعل التلقائي للخاص', type: 'select', options: ['on', 'off'] },
      autoRead: { label: 'قراءة تلقائية', type: 'select', options: ['on', 'off'] },
      autoBlock: { label: 'حظر تلقائي', type: 'select', options: ['on', 'off'] },
      autoReact: { label: 'تفاعل تلقائي', type: 'select', options: ['on', 'off'] },
      autoVoice: { label: 'صوت تلقائي', type: 'select', options: ['on', 'off'] },
      antiDelete: { label: 'مكافحة الحذف بالمجموعات', type: 'select', options: ['on', 'off'] },
      antiDeleteMessages: { label: 'استرجاع الرسائل المحذوفة بالخاص', type: 'select', options: ['on', 'off'] },
      saveDeletedMessageMedia: { label: 'إرسال ميديا الرسائل المحذوفة', type: 'select', options: ['on', 'off'] },
      sendDeleteTo: { label: 'إرسال المحذوف إلى', type: 'text', ph: 'owner' },
      antiCall: { label: 'مكافحة الاتصال', type: 'select', options: ['on', 'off'] },
      excludeCallNumbers: { label: 'أرقام مستثناة', type: 'text', ph: '96777xx,96778yy' },
      statusMsgSend: { label: 'إرسال رسالة على الحالة', type: 'select', options: ['on', 'off'] },
      statusMsgType: { label: 'نوع رسالة الحالة', type: 'text', ph: 'default' },
      customMsg: { label: 'رسالة الحالة المخصصة', type: 'textarea', ph: 'رسالة ترحيب افتراضية' },
      menu: { label: 'صورة المنيو', type: 'text', ph: 'رابط صورة القائمة' },
      alive: { label: 'صورة alive', type: 'text', ph: 'رابط صورة alive' },
      owner: { label: 'صورة المالك', type: 'text', ph: 'رابط صورة المالك' },
      statusCustomReact: { label: 'رموز تعبيرية للحالة (10 كحد أقصى)', type: 'text', ph: '❤️,🔥,👍' },
      antiBug: { label: 'مكافحة البق', type: 'select', options: ['on', 'off'] },
      antiBot: { label: 'مكافحة البوت', type: 'select', options: ['on', 'off'] },
      antiBotAction: { label: 'إجراء مكافحة البوت', type: 'text', ph: 'delete' },
      gaGroupJid: { label: 'معرف الجروب', type: 'text', ph: '' },
      gaTimezone: { label: 'المنطقة الزمنية', type: 'text', ph: 'Asia/Aden' },
      gaCloseTime: { label: 'وقت الإغلاق', type: 'text', ph: '15:00' },
      gaOpenTime: { label: 'وقت الفتح', type: 'text', ph: '05:00' },
      customAutoReplies: { label: 'الردود التلقائية المخصصة', type: 'textarea', ph: 'كلمة:الرد\nhello:أهلا' },
      autoSave: { label: 'الحفظ التلقائي', type: 'select', options: ['on', 'off'] },
      language: { label: 'اللغة', type: 'text', ph: 'arabic' },
      antiViewOnce: { label: 'منع العرض لمرة واحدة', type: 'select', options: ['on', 'off'] },
      antiLinkList: { label: 'الروابط المحظورة', type: 'text', ph: 'wa.me,whatsapp.com' },
      antiBadWords: { label: 'الكلمات المحظورة', type: 'text', ph: 'كلمة1,كلمة2' },
      antiMention: { label: 'منع المنشن', type: 'select', options: ['on', 'off'] },
      antiEdit: { label: 'منع تعديل الرسائل', type: 'text', ph: 'inbox' },
      antiAction: { label: 'إجراء الحماية', type: 'text', ph: 'wern' },
      antiWarnCount: { label: 'عدد التحذيرات', type: 'text', ph: '3' },
      autoReactScope: { label: 'نطاق التفاعل التلقائي', type: 'text', ph: 'inbox' },
      aiReplyScope: { label: 'نطاق الرد الذكي', type: 'text', ph: 'inbox' },
      aliveMsg: { label: 'رسالة alive', type: 'textarea', ph: '❖ *Golden Queen Bot is alive*' },
      voiceFooter: { label: 'رابط الفوتر الصوتي', type: 'text', ph: 'https://...' },
    }
  }

  function createControl(key, meta, value) {
    let el
    if (meta.type === 'textarea') {
      el = document.createElement('textarea')
      el.rows = 3
    } else if (meta.type === 'select') {
      el = document.createElement('select')
      ;(meta.options || []).forEach((opt) => {
        const opEl = document.createElement('option')
        opEl.value = opt
        opEl.textContent = opt
        if (opt === value) opEl.selected = true
        el.appendChild(opEl)
      })
    } else {
      el = document.createElement('input')
      el.type = meta.type === 'number' ? 'number' : 'text'
    }
    if (meta.type !== 'select') el.value = value || ''
    if (meta.ph) el.placeholder = meta.ph
    el.name = key
    el.dataset.settingKey = key
    return el
  }

  function buildSettingsGrid(settings, defaults) {
    const container = qs('panelSettingsGrid')
    if (!container) return
    container.innerHTML = ''
    const groupedLabels = {
      'معلومات أساسية': ['name', 'ownerNumber', 'ownername', 'description', 'from', 'age', 'prefix', 'footer2', 'mode', 'language'],
      'التفاعل والحالات': ['statusCustomReact', 'autoStatusRead', 'autoStatusReact', 'statusViewBoost', 'statusReactionNotice', 'keepDeletedStatus', 'saveDeletedStatusMedia', 'autoRead', 'autoReact', 'autoPrivateReact', 'autoReactScope'],
      'الرد التلقائي والـ AI': ['customAutoReplies', 'aiReplyScope', 'aliveMsg', 'customMsg', 'statusMsgSend', 'statusMsgType', 'voiceFooter'],
      'الحماية والفلاتر': ['antiBad', 'antiBadWords', 'antiLink', 'antiLinkList', 'antiMention', 'antiViewOnce', 'antiBug', 'antiBot', 'antiBotAction', 'antiDelete', 'antiDeleteMessages', 'saveDeletedMessageMedia', 'sendDeleteTo', 'antiEdit', 'antiAction', 'antiWarnCount'],
      'الاتصالات': ['antiCall', 'excludeCallNumbers', 'autoBlock', 'autoVoice'],
      'الوجود والكتابة': ['autoTyping', 'autoRecording', 'alwaysOnline', 'ghostMode'],
      'الإدارة والمحتوى': ['menu', 'alive', 'owner', 'autoSave', 'gaGroupJid', 'gaTimezone', 'gaCloseTime', 'gaOpenTime'],
    }

    const fragment = document.createDocumentFragment()
    Object.entries(groupedLabels).forEach(([groupName, keys]) => {
      const block = document.createElement('div')
      block.className = 'panel-group'
      const head = document.createElement('div')
      head.className = 'panel-group-head'
      head.innerHTML = '<strong>' + escapeHtml(groupName) + '</strong>'
      block.appendChild(head)
      const grid = document.createElement('div')
      grid.className = 'panel-fields'
      keys.forEach((key) => {
        const meta = defaults[key]
        if (!meta) return
        const value = settings[key] != null ? String(settings[key]) : ''
        const fieldEl = document.createElement('label')
        fieldEl.className = 'panel-field'
        const label = document.createElement('span')
        label.textContent = meta.label
        fieldEl.appendChild(label)
        fieldEl.appendChild(createControl(key, meta, value))
        grid.appendChild(fieldEl)
      })
      block.appendChild(grid)
      fragment.appendChild(block)
    })
    container.appendChild(fragment)
  }

  function readFormSettings(form) {
    const out = {}
    form.querySelectorAll('[data-setting-key]').forEach((el) => {
      out[el.dataset.settingKey] = el.value
    })
    return out
  }

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {})
    if (typeof opts.body === 'object' && opts.body !== null && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body)
      opts.headers['Content-Type'] = 'application/json'
    }
    if (STATE.token) opts.headers['x-panel-token'] = STATE.token
    const res = await fetch(path, opts)
    let data = {}
    try { data = await res.json() } catch {}
    return { ok: res.ok, status: res.status, data }
  }

  function showLogin() {
    const a = qs('panelLoginCard'); if (a) a.classList.remove('hidden')
    const b = qs('panelMain'); if (b) b.classList.add('hidden')
  }

  function showMain() {
    const a = qs('panelLoginCard'); if (a) a.classList.add('hidden')
    const b = qs('panelMain'); if (b) b.classList.remove('hidden')
  }

  function renderWallet(wallet) {
    if (!wallet) return
    STATE.wallet = wallet
    safeSet('walletBalance', formatNumber(wallet.balance))
    safeSet('walletClaimed', formatNumber(wallet.totalClaimed))
    safeSet('walletSpent', formatNumber(wallet.totalSpent))
    safeSet('walletNextClaim', wallet.canClaimDaily ? 'متاح الآن' : formatDuration(wallet.remainingMs))
    safeSet('panelTierBadge', wallet.tier || 'STANDARD')
    const badge = qs('panelTierBadge')
    if (badge) badge.className = 'tier-badge ' + (((wallet.tier || '').toLowerCase() === 'vip') ? 'vip' : '')

    const claimBtn = qs('claimDailyBtn')
    if (claimBtn) {
      claimBtn.disabled = !wallet.canClaimDaily
      claimBtn.textContent = wallet.canClaimDaily ? `🎁 طلب ${wallet.dailyAmount} عملة اليوم` : '⏳ بانتظار الموعد التالي'
    }

    const activeWrap = qs('activeFeaturesList')
    if (activeWrap) {
      if (!wallet.activeFeatures || !wallet.activeFeatures.length) {
        activeWrap.className = 'feature-badges empty-state'
        activeWrap.textContent = 'لا توجد مزايا مفعلة حالياً.'
      } else {
        activeWrap.className = 'feature-badges'
        activeWrap.innerHTML = wallet.activeFeatures
          .map((item) => '<div class="feature-badge"><strong>' + escapeHtml(item.title) + '</strong><small>ينتهي: ' + escapeHtml(formatDate(item.activeUntil)) + '</small></div>')
          .join('')
      }
    }
  }

  function renderStore(store) {
    const wrap = qs('storeOffers')
    if (!wrap) return
    wrap.innerHTML = (store || []).map((offer) => (
      '<article class="store-card ' + (offer.active ? 'active' : '') + '">' +
        '<div class="store-card-head">' +
          '<div><span class="eyebrow">' + escapeHtml(offer.key) + '</span>' +
          '<h3>' + escapeHtml(offer.title) + '</h3></div>' +
          '<strong>' + escapeHtml(formatNumber(offer.price)) + ' عملة</strong>' +
        '</div>' +
        '<p>' + escapeHtml(offer.description) + '</p>' +
        '<div class="store-meta">' +
          '<span>' + (offer.active ? 'مفعلة حتى ' + escapeHtml(formatDate(offer.activeUntil)) : 'غير مفعلة') + '</span>' +
          '<button class="btn ' + (offer.active ? 'btn-soft' : 'btn-secondary') + ' buy-offer-btn" data-offer-key="' + escapeHtml(offer.key) + '" type="button" ' + (offer.active ? 'disabled' : '') + '>' + (offer.active ? 'مفعلة حالياً' : 'شراء الآن') + '</button>' +
        '</div>' +
      '</article>'
    )).join('')
    wrap.querySelectorAll('.buy-offer-btn').forEach((btn) => {
      btn.addEventListener('click', () => buyOffer(btn.getAttribute('data-offer-key')))
    })
  }

  // عداد الأرقام الذي يتفاعل معها الرقم المربوط - بطاقة واحدة متحركة متغيرة اللون
  const COUNT_PALETTES = [
    { p: '#22d3ee', p2: '#818cf8', glow: 'rgba(34, 211, 238, 0.55)' },
    { p: '#a78bfa', p2: '#f472b6', glow: 'rgba(167, 139, 250, 0.55)' },
    { p: '#f472b6', p2: '#fb7185', glow: 'rgba(244, 114, 182, 0.55)' },
    { p: '#fbbf24', p2: '#f97316', glow: 'rgba(251, 191, 36, 0.55)' },
    { p: '#34d399', p2: '#06b6d4', glow: 'rgba(52, 211, 153, 0.55)' },
    { p: '#60a5fa', p2: '#a78bfa', glow: 'rgba(96, 165, 250, 0.55)' },
  ]
  let countPaletteIndex = 0
  let countColorTimer = null

  function applyCountPalette() {
    const pal = COUNT_PALETTES[countPaletteIndex]
    document.documentElement.style.setProperty('--c-primary', pal.p)
    document.documentElement.style.setProperty('--c-primary-2', pal.p2)
    document.documentElement.style.setProperty('--c-glow', pal.glow)
    const card = qs('statusReactionsList')
    if (card) {
      card.style.setProperty('--count-glow', pal.glow)
      card.style.setProperty('--count-stroke', pal.p)
      card.style.setProperty('--count-accent', pal.p)
      card.style.setProperty('--grad-count', 'linear-gradient(135deg, ' + pal.p + ', ' + pal.p2 + ')')
      card.style.setProperty('--grad-count-text', 'linear-gradient(135deg, ' + pal.p + ', ' + pal.p2 + ')')
    }
  }

  function startCountColorCycle() {
    applyCountPalette()
    if (countColorTimer) clearInterval(countColorTimer)
    countColorTimer = setInterval(() => {
      countPaletteIndex = (countPaletteIndex + 1) % COUNT_PALETTES.length
      applyCountPalette()
    }, 1000)
  }

  function renderReactions(reactions) {
    try {
      STATE.reactions = reactions || {}
      const active = STATE.reactions.indicator === 'active'
      const hero = qs('reactionHero')
      if (hero) hero.classList.toggle('active', active)
      const dot = qs('reactionDot')
      if (dot) dot.className = 'reaction-dot' + (active ? ' active' : '')
      safeSet('reactionIndicatorText', active ? 'التفاعل ظاهر الآن باللون الأخضر' : 'لا يوجد تفاعل حديث')
      safeSet('reactionTotalCount', formatNumber(STATE.reactions.total || 0) + ' عملية')

      if (STATE.reactions.latestReaction && STATE.reactions.latestReaction.emoji) {
        const lr = STATE.reactions.latestReaction
        safeSet('reactionLatestMeta', 'آخر تفاعل: ' + lr.emoji + ' على حالة ' + (lr.participantLabel || lr.participantNumber || '—') + ' — ' + formatDate(lr.reactedAt))
      } else {
        safeSet('reactionLatestMeta', 'سيظهر هنا آخر تفاعل ناجح على الحالات.')
      }

      const wrap = qs('statusReactionsList')
      if (!wrap) return
      const logs = STATE.reactions.logs || []
      const uniqueNumbers = new Set(
        logs.map((item) => item.participantNumber || item.participantLabel).filter(Boolean)
      )

      wrap.className = 'reaction-count-card'
      wrap.innerHTML =
        '<div class="reaction-count-glow"></div>' +
        '<div class="reaction-count-ring">' +
          '<span class="reaction-count-num">' + formatNumber(uniqueNumbers.size) + '</span>' +
          '<span class="reaction-count-label">رقم</span>' +
        '</div>' +
        '<div class="reaction-count-info">' +
          '<span class="reaction-count-eyebrow">عدد الأرقام التي تفاعل معها الرقم المربوط</span>' +
          '<strong class="reaction-count-title">إجمالي التفاعلات: ' + formatNumber(STATE.reactions.total || logs.length) + '</strong>' +
          '<small class="reaction-count-sub">آخر تحديث: ' + escapeHtml(formatDate((logs[0] && logs[0].reactedAt) || new Date().toISOString())) + '</small>' +
        '</div>' +
        '<div class="reaction-count-orbit">' +
          '<span></span><span></span><span></span>' +
        '</div>'

      startCountColorCycle()
    } catch (e) {
      console.error('renderReactions failed:', e)
    }
  }

  async function loadSettings() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    STATE.settings = data.settings || {}
    safeSet('panelHeaderNumber', (data.number || STATE.number))
    safeSet('panelStatusLabel', data.status || '—')
    safeSet('panelEmojiLabel', data.emoji || '❤️')
    buildSettingsGrid(STATE.settings, STATE.fieldMeta)
  }

  async function loadWalletAndStore() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    try { renderWallet(data.wallet) } catch (e) { console.error('renderWallet failed:', e) }
    try { renderStore(data.store || []) } catch (e) { console.error('renderStore failed:', e) }
  }

  async function loadReactionLog() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/status-reactions')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    renderReactions(data.reactions || {})
  }

  async function loadAll() {
    const results = await Promise.allSettled([loadSettings(), loadWalletAndStore(), loadReactionLog()])
    const authError = results.find((r) => r.status === 'rejected')
    if (authError) {
      STATE.token = ''
      try { localStorage.removeItem('panel_token_' + STATE.number) } catch {}
      showLogin()
      const msg = (authError.reason && authError.reason.message) || 'انتهت الجلسة، سجّل الدخول مجدداً.'
      setStatus(qs('panelLoginStatus'), msg, 'error')
      return
    }
    showMain()
  }

  async function handleLogin(ev) {
    ev.preventDefault()
    const number = qs('panelNumberInput').value.replace(/\D/g, '')
    const password = qs('panelPasswordInput').value
    const statusEl = qs('panelLoginStatus')
    setStatus(statusEl, 'جاري التحقق...')
    if (!number || !password) {
      setStatus(statusEl, 'أدخل الرقم وكلمة المرور.', 'error')
      return
    }
    try {
      const res = await fetch('/api/panel/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, password }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setStatus(statusEl, (data && data.error) || 'فشل تسجيل الدخول.', 'error')
        return
      }
      STATE.number = data.number
      STATE.token = data.token
      localStorage.setItem('panel_token_' + STATE.number, STATE.token)
      const pw = qs('panelPasswordInput'); if (pw) pw.value = ''
      setStatus(statusEl, 'تم تسجيل الدخول بنجاح.', 'success')
      history.replaceState({}, '', '/panel/' + STATE.number)
      await loadAll()
    } catch (e) {
      setStatus(statusEl, e.message || 'فشل تسجيل الدخول.', 'error')
    }
  }

  async function handleSave() {
    const status = qs('panelSaveStatus')
    const settings = readFormSettings(qs('panelSettingsGrid'))
    setStatus(status, 'جاري الحفظ...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings', {
        method: 'POST', body: { settings },
      })
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'فشل الحفظ.', 'error')
        return
      }
      STATE.settings = data.settings || STATE.settings
      safeSet('panelEmojiLabel', STATE.settings.statusCustomReact || '❤️')
      setStatus(status, '✅ تم حفظ الإعدادات بنجاح.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل الحفظ.', 'error')
    }
  }

  async function handlePair(ev) {
    ev.preventDefault()
    const status = qs('panelPairStatus')
    const target = qs('panelPairNumber').value.replace(/\D/g, '')
    if (!target) { setStatus(status, 'أدخل الرقم الهدف.', 'error'); return }
    setStatus(status, 'جاري إصدار كود الاقتران...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/pair', {
        method: 'POST', body: { number: target },
      })
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'فشل إصدار الكود.', 'error')
        const box = qs('panelPairCodeBox'); if (box) box.classList.add('hidden')
        return
      }
      const rawCode = String((data && data.rawCode) || '').replace(/[^A-Za-z0-9]/g, '')
      safeSet('panelPairCode', data.code || rawCode || '—')
      const box = qs('panelPairCodeBox'); if (box) box.classList.remove('hidden')
      let copied = false
      try {
        await navigator.clipboard.writeText(rawCode)
        copied = true
      } catch {}
      setStatus(status, copied
        ? '✅ تم إصدار الكود ونسخه تلقائياً. ألصقه الآن في واتساب بدون شرطات أو مسافات إضافية.'
        : '✅ تم إصدار الكود بنجاح. أدخله في واتساب بدون شرطات أو مسافات إضافية.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل إصدار الكود.', 'error')
    }
  }

  async function handlePasswordChange(ev) {
    ev.preventDefault()
    const status = qs('panelPasswordStatus')
    const current = qs('panelCurrentPassword').value
    const next = qs('panelNewPassword').value
    setStatus(status, 'جاري التحديث...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/password', {
        method: 'POST', body: { currentPassword: current, newPassword: next },
      })
      if (!ok || !data.ok) { setStatus(status, (data && data.error) || 'فشل تحديث كلمة المرور.', 'error'); return }
      const a = qs('panelCurrentPassword'); if (a) a.value = ''
      const b = qs('panelNewPassword'); if (b) b.value = ''
      setStatus(status, '✅ تم تحديث كلمة المرور.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل التحديث.', 'error')
    }
  }

  async function handleClaimDaily() {
    const status = qs('walletStatus')
    setStatus(status, 'جاري طلب المكافأة اليومية...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/claim-daily', {
        method: 'POST', body: {},
      })
      if (!ok || !data.ok) {
        const nextText = data && data.remainingMs ? (' متاح بعد ' + formatDuration(data.remainingMs) + '.') : ''
        setStatus(status, ((data && data.error) || 'تعذر استلام المكافأة اليومية.') + nextText, 'error')
        return
      }
      renderWallet(data.wallet)
      setStatus(status, '✅ تم إضافة ' + data.amount + ' عملة إلى رصيدك.' + (data.notificationSent ? ' وتم إرسال إشعار خاص إلى الرقم.' : ''), 'success')
    } catch (e) {
      setStatus(status, e.message || 'تعذر استلام المكافأة اليومية.', 'error')
    }
  }

  async function buyOffer(offerKey) {
    const status = qs('storeStatus')
    setStatus(status, 'جاري تنفيذ عملية الشراء...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/store/buy', {
        method: 'POST', body: { offerKey },
      })
      if (!ok || !data.ok) { setStatus(status, (data && data.error) || 'تعذر تنفيذ عملية الشراء.', 'error'); return }
      try { renderWallet(data.result.wallet) } catch {}
      try {
        const { data: refreshed } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')
        renderStore((refreshed && refreshed.store) || [])
      } catch {}
      setStatus(status, '✅ تم شراء ' + (data.result && data.result.offer && data.result.offer.title) + ' بنجاح.' + (data.notificationSent ? ' وتم إرسال إشعار خاص.' : ''), 'success')
    } catch (e) {
      setStatus(status, e.message || 'تعذر تنفيذ عملية الشراء.', 'error')
    }
  }

  async function handleLogout() {
    try { if (STATE.token) await api('/api/panel/logout', { method: 'POST', body: {} }) } catch {}
    try { localStorage.removeItem('panel_token_' + STATE.number) } catch {}
    STATE.token = ''
    STATE.number = ''
    history.replaceState({}, '', '/panel')
    const grid = qs('panelSettingsGrid'); if (grid) grid.innerHTML = ''
    showLogin()
  }

  function installAutoRefresh() {
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer)
    STATE.refreshTimer = setInterval(() => {
      if (!STATE.number || !STATE.token) return
      loadWalletAndStore().catch(() => {})
      loadReactionLog().catch(() => {})
    }, 15000)
  }

  async function init() {
    startPanelThemeCycle()
    loadDefaults()

    const form = qs('panelLoginForm')
    if (form) form.addEventListener('submit', handleLogin)
    const saveBtn = qs('panelSaveBtn'); if (saveBtn) saveBtn.addEventListener('click', handleSave)
    const reloadBtn = qs('panelReloadBtn'); if (reloadBtn) reloadBtn.addEventListener('click', () => loadAll())
    const pairForm = qs('panelPairForm'); if (pairForm) pairForm.addEventListener('submit', handlePair)
    const pwdForm = qs('panelPasswordForm'); if (pwdForm) pwdForm.addEventListener('submit', handlePasswordChange)
    const logoutBtn = qs('panelLogoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', handleLogout)
    const claimBtn = qs('claimDailyBtn'); if (claimBtn) claimBtn.addEventListener('click', handleClaimDaily)

    const numberInUrl = startWithNumber()
    if (numberInUrl) {
      const numberInput = qs('panelNumberInput')
      if (numberInput) numberInput.value = numberInUrl
      try {
        const res = await fetch('/api/panel/' + encodeURIComponent(numberInUrl) + '/default-password')
        const data = await res.json()
        if (data && data.ok) {
          const hint = qs('panelPasswordHint')
          if (hint) hint.textContent = data.hasCustomPassword
            ? 'تم تعيين كلمة مرور مخصصة لهذا الرقم.'
            : 'كلمة المرور الافتراضية: ' + data.defaultPassword + ' (نفس الرقم).'
        }
      } catch (e) { console.warn('default-password hint failed', e) }
      const saved = localStorage.getItem('panel_token_' + numberInUrl)
      if (saved) {
        STATE.number = numberInUrl
        STATE.token = saved
        try { await loadAll() } catch (e) { console.error('loadAll bootstrap failed:', e) }
      }
    }

    installAutoRefresh()
  }

  init().catch((e) => console.error('panel init error', e))
})()
