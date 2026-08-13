(function () {
  const STATE = {
    number: '',
    token: '',
    settings: {},
    wallet: null,
    reactions: null,
    refreshTimer: null,
  }

  const FIELD_META = {
    name: { label: 'Bot Name', type: 'text', ph: 'Golden Queen Bot' },
    ownerNumber: { label: 'Owner Number', type: 'text', ph: '96777XXXXXXX' },
    ownername: { label: 'Owner Name', type: 'text', ph: 'اسم المالك' },
    description: { label: 'Description', type: 'textarea', ph: 'وصف مختصر للبوت', full: true },
    from: { label: 'Location', type: 'text', ph: 'Yemen' },
    age: { label: 'Age', type: 'text', ph: '24' },
    prefix: { label: 'Prefix', type: 'text', ph: '.' },
    footer2: { label: 'Footer', type: 'text', ph: 'Golden Queen Bot' },
    mode: { label: 'Mode', type: 'select', options: ['private', 'public', 'group', 'inbox', 'self'] },
    language: { label: 'Language', type: 'select', options: ['arabic', 'english', 'sinhala', 'tamil'] },

    antiBad: { label: 'Anti Bad Word', type: 'select', options: ['on', 'off'] },
    antiLink: { label: 'Anti Link', type: 'select', options: ['on', 'off'] },
    antiSpam: { label: 'Anti Spam', type: 'select', options: ['on', 'off'] },
    antiGroupAdd: { label: 'Anti Group Add', type: 'select', options: ['on', 'off'] },
    antiPrivateMessages: { label: 'Anti Private Messages', type: 'select', options: ['on', 'off'] },
    alwaysOnline: { label: 'Always Online', type: 'select', options: ['on', 'off'] },
    autoTyping: { label: 'Auto Typing', type: 'select', options: ['on', 'off'] },
    autoRecording: { label: 'Auto Recording', type: 'select', options: ['on', 'off'] },
    autoRead: { label: 'Auto Read', type: 'select', options: ['on', 'off'] },
    autoReact: { label: 'Auto React', type: 'select', options: ['on', 'off'] },
    autoPrivateReact: { label: 'Auto Private React', type: 'select', options: ['on', 'off'] },
    autoVoice: { label: 'Auto Voice', type: 'select', options: ['on', 'off'] },
    autoBlock: { label: 'Auto Block', type: 'select', options: ['on', 'off'] },
    autoSave: { label: 'Auto Save', type: 'select', options: ['on', 'off'] },
    ghostMode: { label: 'Ghost Mode', type: 'select', options: ['on', 'off'] },
    antiViewOnce: { label: 'Anti View Once', type: 'select', options: ['on', 'off'] },

    autoStatusRead: { label: 'Status Seen', type: 'select', options: ['on', 'off'] },
    autoStatusReact: { label: 'Status React', type: 'select', options: ['on', 'off'] },
    statusReactionNotice: { label: 'Reaction Notice', type: 'select', options: ['on', 'off'] },
    statusViewBoost: { label: 'Status View Boost', type: 'select', options: ['on', 'off'] },
    statusMsgSend: { label: 'Status Message Send', type: 'select', options: ['on', 'off'] },
    statusMsgType: { label: 'Status Message Type', type: 'select', options: ['default', 'custom'] },
    customMsg: { label: 'Custom Status Message', type: 'textarea', ph: 'رسالة حالة مخصصة', full: true },
    statusCustomReact: { label: 'Status Reaction Emojis', type: 'text', ph: '❤️,🔥,👍' },
    customAutoReplies: { label: 'Custom Auto Replies', type: 'textarea', ph: 'مرحبا:أهلاً بك\nسعر:تواصل مع المطور', full: true },
    aiReplyScope: { label: 'AI Reply Scope', type: 'select', options: ['inbox', 'groups', 'both'] },
    autoReactScope: { label: 'Auto React Scope', type: 'select', options: ['inbox', 'groups', 'both'] },
    aliveMsg: { label: 'Alive Message', type: 'textarea', ph: '❖ *Golden Queen Bot is alive*', full: true },
    voiceFooter: { label: 'Voice Footer URL', type: 'text', ph: 'https://...' },

    menu: { label: 'Menu Logo URL', type: 'text', ph: 'https://...' },
    alive: { label: 'Alive Logo URL', type: 'text', ph: 'https://...' },
    owner: { label: 'Owner Logo URL', type: 'text', ph: 'https://...' },

    antiCall: { label: 'Anti Call', type: 'select', options: ['on', 'off'] },
    excludeCallNumbers: { label: 'Excluded Numbers', type: 'text', ph: '96777...,96778...' },
    antiDelete: { label: 'Anti Delete', type: 'select', options: ['on', 'off'] },
    antiDeleteMessages: { label: 'Anti Delete Messages', type: 'select', options: ['on', 'off'] },
    saveDeletedMessageMedia: { label: 'Save Deleted Message Media', type: 'select', options: ['on', 'off'] },
    sendDeleteTo: { label: 'Send Deleted To', type: 'select', options: ['owner', 'inbox', 'group', 'same'] },
    keepDeletedStatus: { label: 'Keep Deleted Status', type: 'select', options: ['on', 'off'] },
    saveDeletedStatusMedia: { label: 'Save Deleted Status Media', type: 'select', options: ['on', 'off'] },
    deletedStatusArchiveSize: { label: 'Deleted Status Archive Size', type: 'text', ph: '0' },
    deletedMessageArchiveSize: { label: 'Deleted Message Archive Size', type: 'text', ph: '0' },

    antiBug: { label: 'Anti Bug', type: 'select', options: ['on', 'off'] },
    antiBot: { label: 'Anti Bot', type: 'select', options: ['on', 'off'] },
    antiBotAction: { label: 'Anti Bot Action', type: 'select', options: ['delete', 'delete+kick', 'kick'] },
    antiBadWords: { label: 'Blocked Words', type: 'text', ph: 'word1,word2' },
    antiLinkList: { label: 'Blocked Links', type: 'text', ph: 'wa.me,whatsapp.com' },
    antiMention: { label: 'Anti Mention', type: 'select', options: ['on', 'off'] },
    antiEdit: { label: 'Anti Edit Scope', type: 'select', options: ['off', 'inbox', 'group', 'all'] },
    antiAction: { label: 'Protection Action', type: 'select', options: ['warn', 'wern', 'delete', 'remove', 'block'] },
    antiWarnCount: { label: 'Warning Count', type: 'text', ph: '3' },

    gaGroupJid: { label: 'Group JID', type: 'text', ph: '120363xxxxxxxx@g.us', full: true },
    gaTimezone: { label: 'Timezone', type: 'select', options: ['Asia/Aden', 'Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'UTC'] },
    gaCloseTime: { label: 'Close Time', type: 'text', ph: '15:00' },
    gaOpenTime: { label: 'Open Time', type: 'text', ph: '05:00' },
  }

  const GROUPS = [
    {
      title: 'Basic Info',
      subtitle: 'المعلومات الأساسية الخاصة بالرقم والبوت.',
      icon: '👤',
      color: '#60a5fa',
      color2: '#3b82f6',
      keys: ['name', 'ownerNumber', 'ownername', 'description', 'from', 'age', 'prefix', 'footer2', 'mode', 'language'],
    },
    {
      title: 'System Automation',
      subtitle: 'أتمتة السلوك العام والحالات والقراءة والتفاعل.',
      icon: '⚡',
      color: '#c084fc',
      color2: '#8b5cf6',
      keys: ['antiBad', 'antiLink', 'antiSpam', 'antiGroupAdd', 'antiPrivateMessages', 'alwaysOnline', 'autoTyping', 'autoRecording', 'autoRead', 'autoReact', 'autoPrivateReact', 'autoVoice', 'autoBlock', 'autoSave', 'ghostMode', 'antiViewOnce'],
    },
    {
      title: 'Status & Smart Replies',
      subtitle: 'إعدادات الحالات والردود الذكية والـ AI.',
      icon: '💬',
      color: '#22d3ee',
      color2: '#06b6d4',
      keys: ['autoStatusRead', 'autoStatusReact', 'statusReactionNotice', 'statusViewBoost', 'statusMsgSend', 'statusMsgType', 'customMsg', 'statusCustomReact', 'customAutoReplies', 'aiReplyScope', 'autoReactScope', 'aliveMsg', 'voiceFooter'],
    },
    {
      title: 'Logos',
      subtitle: 'روابط صور القائمة و alive وصورة المالك.',
      icon: '🖼️',
      color: '#fbbf24',
      color2: '#f59e0b',
      keys: ['menu', 'alive', 'owner'],
    },
    {
      title: 'Calls & Anti-Delete',
      subtitle: 'المكالمات والاستثناءات وحماية الرسائل والحالات المحذوفة.',
      icon: '📞',
      color: '#fb923c',
      color2: '#f97316',
      keys: ['antiCall', 'excludeCallNumbers', 'antiDelete', 'antiDeleteMessages', 'saveDeletedMessageMedia', 'sendDeleteTo', 'keepDeletedStatus', 'saveDeletedStatusMedia', 'deletedStatusArchiveSize', 'deletedMessageArchiveSize'],
    },
    {
      title: 'Protection Filters',
      subtitle: 'الفلاتر والحماية ضد البق والبوتات والمنشن والروابط والكلمات.',
      icon: '🛡️',
      color: '#f472b6',
      color2: '#ec4899',
      keys: ['antiBug', 'antiBot', 'antiBotAction', 'antiBadWords', 'antiLinkList', 'antiMention', 'antiEdit', 'antiAction', 'antiWarnCount'],
    },
    {
      title: 'Group Automation',
      subtitle: 'جدولة فتح وإغلاق المجموعات والمنطقة الزمنية.',
      icon: '🕒',
      color: '#4ade80',
      color2: '#22c55e',
      keys: ['gaGroupJid', 'gaTimezone', 'gaCloseTime', 'gaOpenTime'],
    },
  ]

  function qs(id) {
    return document.getElementById(id)
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function mirrorStickyStatus(text, kind) {
    const sticky = qs('panelStickyStatus')
    if (!sticky) return
    sticky.className = 'form-status' + (kind ? ' ' + kind : '')
    sticky.textContent = text || 'جاهز للحفظ'
  }

  function setStatus(el, text, kind) {
    if (!el) return
    el.className = 'form-status' + (kind ? ' ' + kind : '')
    el.textContent = text || ''
    if (el.id === 'panelSaveStatus') mirrorStickyStatus(text, kind)
  }

  function safeSet(id, text) {
    const el = qs(id)
    if (el) el.textContent = text
  }

  function formatDate(value) {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString('ar')
    } catch {
      return '—'
    }
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

  function startWithNumber() {
    const path = window.location.pathname || ''
    const match = path.match(/\/panel\/([\d]+)/)
    return match ? match[1] : ''
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
        if (String(opt) === String(value)) opEl.selected = true
        el.appendChild(opEl)
      })
    } else {
      el = document.createElement('input')
      el.type = 'text'
    }

    if (meta.type !== 'select') el.value = value || ''
    if (meta.ph) el.placeholder = meta.ph
    el.name = key
    el.dataset.settingKey = key
    return el
  }

  function buildSettingsGrid(settings) {
    const container = qs('panelSettingsGrid')
    if (!container) return
    container.innerHTML = ''
    const fragment = document.createDocumentFragment()

    GROUPS.forEach((group) => {
      const block = document.createElement('section')
      block.className = 'panel-group'
      block.style.setProperty('--panel-p', group.color)
      block.style.setProperty('--panel-p2', group.color2)
      block.style.setProperty('--panel-glow', group.color + '55')

      const head = document.createElement('div')
      head.className = 'panel-group-head'
      head.innerHTML =
        '<div class="panel-group-icon">' + escapeHtml(group.icon) + '</div>' +
        '<div class="panel-group-title"><strong>' + escapeHtml(group.title) + '</strong><span>' + escapeHtml(group.subtitle) + '</span></div>'
      block.appendChild(head)

      const grid = document.createElement('div')
      grid.className = 'panel-fields'

      group.keys.forEach((key) => {
        const meta = FIELD_META[key]
        if (!meta) return
        const value = settings[key] != null ? String(settings[key]) : ''
        const fieldWrap = document.createElement('label')
        fieldWrap.className = 'panel-field' + ((meta.full || meta.type === 'textarea') ? ' panel-field--full' : '')
        const title = document.createElement('span')
        title.textContent = meta.label
        fieldWrap.appendChild(title)
        fieldWrap.appendChild(createControl(key, meta, value))
        grid.appendChild(fieldWrap)
      })

      block.appendChild(grid)
      fragment.appendChild(block)
    })

    container.appendChild(fragment)
  }

  function readFormSettings(form) {
    const out = {}
    if (!form) return out
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
    qs('panelLoginCard')?.classList.remove('hidden')
    qs('panelMain')?.classList.add('hidden')
  }

  function showMain() {
    qs('panelLoginCard')?.classList.add('hidden')
    qs('panelMain')?.classList.remove('hidden')
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
      claimBtn.textContent = wallet.canClaimDaily ? `طلب ${wallet.dailyAmount} عملة اليوم` : 'بانتظار الموعد التالي'
    }

    const activeWrap = qs('activeFeaturesList')
    if (activeWrap) {
      if (!wallet.activeFeatures || !wallet.activeFeatures.length) {
        activeWrap.className = 'feature-badges comments-feed empty-state'
        activeWrap.textContent = 'لا توجد مزايا مفعلة حالياً.'
      } else {
        activeWrap.className = 'feature-badges'
        activeWrap.innerHTML = wallet.activeFeatures
          .map((item) => '<div class="comment-item"><strong>' + escapeHtml(item.title) + '</strong><div class="comment-meta">ينتهي: ' + escapeHtml(formatDate(item.activeUntil)) + '</div></div>')
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
          '<div><span class="comment-meta">' + escapeHtml(offer.key) + '</span>' +
          '<h3>' + escapeHtml(offer.title) + '</h3></div>' +
          '<strong>' + escapeHtml(formatNumber(offer.price)) + ' عملة</strong>' +
        '</div>' +
        '<p>' + escapeHtml(offer.description) + '</p>' +
        '<div class="store-meta">' +
          '<span class="comment-meta">' + (offer.active ? 'مفعلة حتى ' + escapeHtml(formatDate(offer.activeUntil)) : 'غير مفعلة') + '</span>' +
          '<button class="btn ' + (offer.active ? 'btn-soft' : 'btn-secondary') + ' buy-offer-btn" data-offer-key="' + escapeHtml(offer.key) + '" type="button" ' + (offer.active ? 'disabled' : '') + '>' + (offer.active ? 'مفعلة حالياً' : 'شراء الآن') + '</button>' +
        '</div>' +
      '</article>'
    )).join('')

    wrap.querySelectorAll('.buy-offer-btn').forEach((btn) => {
      btn.addEventListener('click', () => buyOffer(btn.getAttribute('data-offer-key')))
    })
  }

  const COUNT_PALETTES = [
    { p: '#22d3ee', p2: '#818cf8', glow: 'rgba(34, 211, 238, 0.55)' },
    { p: '#a78bfa', p2: '#f472b6', glow: 'rgba(167, 139, 250, 0.55)' },
    { p: '#f472b6', p2: '#fb7185', glow: 'rgba(244, 114, 182, 0.55)' },
    { p: '#fbbf24', p2: '#f97316', glow: 'rgba(251, 191, 36, 0.55)' },
    { p: '#34d399', p2: '#06b6d4', glow: 'rgba(52, 211, 153, 0.55)' },
  ]
  let countPaletteIndex = 0
  let countColorTimer = null

  function applyCountPalette() {
    const pal = COUNT_PALETTES[countPaletteIndex]
    const card = qs('statusReactionsList')
    if (!card) return
    card.style.setProperty('--count-glow', pal.glow)
    card.style.setProperty('--count-stroke', pal.p)
    card.style.setProperty('--grad-count', 'linear-gradient(135deg, ' + pal.p + ', ' + pal.p2 + ')')
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
    STATE.reactions = reactions || {}
    const active = STATE.reactions.indicator === 'active'
    const hero = qs('reactionHero')
    if (hero) {
      hero.className = 'status-pill'
      hero.textContent = active ? 'التفاعل ظاهر الآن باللون الأخضر' : 'لا يوجد تفاعل حديث'
    }

    if (STATE.reactions.latestReaction && STATE.reactions.latestReaction.emoji) {
      const lr = STATE.reactions.latestReaction
      safeSet('reactionLatestMeta', 'آخر تفاعل: ' + lr.emoji + ' على حالة ' + (lr.participantLabel || lr.participantNumber || '—') + ' — ' + formatDate(lr.reactedAt))
    } else {
      safeSet('reactionLatestMeta', 'سيظهر هنا آخر تفاعل ناجح على الحالات.')
    }

    const wrap = qs('statusReactionsList')
    if (!wrap) return
    const logs = STATE.reactions.logs || []
    const uniqueNumbers = new Set(logs.map((item) => item.participantNumber || item.participantLabel).filter(Boolean))

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
      '<div class="reaction-count-orbit"><span></span><span></span><span></span></div>'

    startCountColorCycle()
  }

  async function loadSettings() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    STATE.settings = data.settings || {}
    safeSet('panelHeaderNumber', data.number || STATE.number)
    safeSet('panelStatusLabel', data.status || '—')
    safeSet('panelEmojiLabel', data.emoji || STATE.settings.statusCustomReact || '❤️')
    buildSettingsGrid(STATE.settings)
  }

  async function loadWalletAndStore() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    renderWallet(data.wallet)
    renderStore(data.store || [])
  }

  async function loadReactionLog() {
    const { ok, status, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/status-reactions')
    if (status === 401 || status === 403) throw new Error((data && data.error) || 'انتهت الجلسة.')
    if (!ok || !data.ok) return
    renderReactions(data.reactions || {})
  }

  async function loadAll() {
    const results = await Promise.allSettled([loadSettings(), loadWalletAndStore(), loadReactionLog()])
    const failed = results.find((r) => r.status === 'rejected')
    if (failed) {
      STATE.token = ''
      try { localStorage.removeItem('panel_token_' + STATE.number) } catch {}
      showLogin()
      setStatus(qs('panelLoginStatus'), (failed.reason && failed.reason.message) || 'انتهت الجلسة، سجّل الدخول مجدداً.', 'error')
      return
    }
    showMain()
  }

  async function handleLogin(ev) {
    ev.preventDefault()
    const number = (qs('panelNumberInput')?.value || '').replace(/\D/g, '')
    const password = qs('panelPasswordInput')?.value || ''
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
      if (qs('panelPasswordInput')) qs('panelPasswordInput').value = ''
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
    setStatus(status, 'جاري حفظ الإعدادات...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings', {
        method: 'POST',
        body: { settings },
      })
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'فشل الحفظ.', 'error')
        return
      }
      STATE.settings = data.settings || STATE.settings
      safeSet('panelEmojiLabel', STATE.settings.statusCustomReact || '❤️')
      setStatus(status, '✅ تم حفظ الإعدادات وتطبيقها على الرقم المربوط.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل الحفظ.', 'error')
    }
  }

  async function handlePair(ev) {
    ev.preventDefault()
    const status = qs('panelPairStatus')
    const target = (qs('panelPairNumber')?.value || '').replace(/\D/g, '')
    if (!target) { setStatus(status, 'أدخل الرقم الهدف.', 'error'); return }
    setStatus(status, 'جاري إصدار كود الاقتران...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/pair', {
        method: 'POST', body: { number: target },
      })
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'فشل إصدار الكود.', 'error')
        qs('panelPairCodeBox')?.classList.add('hidden')
        return
      }
      safeSet('panelPairCode', data.code || '—')
      qs('panelPairCodeBox')?.classList.remove('hidden')
      setStatus(status, '✅ تم إصدار الكود بنجاح.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل إصدار الكود.', 'error')
    }
  }

  async function handlePasswordChange(ev) {
    ev.preventDefault()
    const status = qs('panelPasswordStatus')
    const current = qs('panelCurrentPassword')?.value || ''
    const next = qs('panelNewPassword')?.value || ''
    setStatus(status, 'جاري تحديث كلمة المرور...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/password', {
        method: 'POST', body: { currentPassword: current, newPassword: next },
      })
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'فشل تحديث كلمة المرور.', 'error')
        return
      }
      if (qs('panelCurrentPassword')) qs('panelCurrentPassword').value = ''
      if (qs('panelNewPassword')) qs('panelNewPassword').value = ''
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
      if (!ok || !data.ok) {
        setStatus(status, (data && data.error) || 'تعذر تنفيذ عملية الشراء.', 'error')
        return
      }
      renderWallet(data.result.wallet)
      try {
        const refreshed = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')
        renderStore((refreshed.data && refreshed.data.store) || [])
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
    qs('panelSettingsGrid') && (qs('panelSettingsGrid').innerHTML = '')
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

  async function initDefaultPasswordHint(numberInUrl) {
    try {
      const res = await fetch('/api/panel/' + encodeURIComponent(numberInUrl) + '/default-password')
      const data = await res.json()
      if (data && data.ok) {
        const hint = qs('panelPasswordHint')
        if (hint) hint.textContent = data.hasCustomPassword
          ? 'تم تعيين كلمة مرور مخصصة لهذا الرقم.'
          : 'كلمة المرور الافتراضية: ' + data.defaultPassword + ' (نفس الرقم).'
      }
    } catch (e) {
      console.warn('default-password hint failed', e)
    }
  }

  async function init() {
    qs('panelLoginForm')?.addEventListener('submit', handleLogin)
    qs('panelSaveBtn')?.addEventListener('click', handleSave)
    qs('panelReloadBtn')?.addEventListener('click', () => loadAll())
    qs('panelPairForm')?.addEventListener('submit', handlePair)
    qs('panelPasswordForm')?.addEventListener('submit', handlePasswordChange)
    qs('panelLogoutBtn')?.addEventListener('click', handleLogout)
    qs('claimDailyBtn')?.addEventListener('click', handleClaimDaily)

    const numberInUrl = startWithNumber()
    if (numberInUrl) {
      const numberInput = qs('panelNumberInput')
      if (numberInput) numberInput.value = numberInUrl
      await initDefaultPasswordHint(numberInUrl)
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
