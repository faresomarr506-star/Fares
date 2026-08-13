(() => {
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
    const { res, data } = await api('/api/public/config')
    if (!res.ok || !data.ok) throw new Error(data.error || 'تعذر تحميل إعدادات الموقع.')
    set('siteTitle', data.config.siteTitle)
    set('siteDescription', data.config.siteDescription)
    const channel = $('channelLink')
    if (channel) channel.href = data.config.whatsappChannelUrl || '#'
  }
  async function loadStats() {
    const { res, data } = await api('/api/public/stats')
    if (!res.ok || !data.ok) throw new Error(data.error || 'تعذر تحميل إحصائيات الموقع.')
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
    const { res, data } = await api('/api/public/comments')
    if (!res.ok || !data.ok) throw new Error(data.error || 'تعذر تحميل التعليقات.')
    renderComments(data.comments || [])
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
    const boot = await Promise.allSettled([loadConfig(), loadStats(), loadComments()])
    const failed = boot.find((item) => item.status === 'rejected')
    if (failed) {
      const message = failed.reason?.message || 'تعذر تحميل بعض بيانات الموقع حالياً.'
      set('statsUpdated', message)
      if (!$('commentsList')?.innerHTML) {
        renderComments([])
      }
      console.warn('[landing:init]', message)
    }
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
