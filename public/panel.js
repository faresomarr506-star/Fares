(() => {
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
