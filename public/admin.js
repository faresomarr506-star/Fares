const TOKEN_KEY = 'fares_bot_admin_token'

function qs(id) {
  return document.getElementById(id)
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('ar')
  } catch {
    return '—'
  }
}

function setStatus(id, text, kind = '') {
  const el = qs(id)
  if (!el) return
  el.className = `form-status ${kind}`.trim()
  el.textContent = text
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function adminFetch(url, options = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {}),
    'x-admin-token': token,
  }
  return fetch(url, { ...options, headers })
}

function renderComments(comments) {
  const feed = qs('adminCommentsFeed')
  if (!comments.length) {
    feed.className = 'comments-feed empty-state'
    feed.textContent = 'لا توجد تعليقات حالياً.'
    return
  }

  feed.className = 'comments-feed'
  feed.innerHTML = comments
    .map((comment) => {
      const existingReply = comment.reply
        ? `<div class="comment-reply"><strong>الرد الحالي — ${escapeHtml(comment.reply.by || 'المطور')}</strong><div class="comment-message">${escapeHtml(comment.reply.text)}</div><div class="comment-meta">${escapeHtml(formatDate(comment.reply.createdAt))}</div></div>`
        : ''
      const contact = comment.contact ? `<div class="comment-contact">${escapeHtml(comment.contact)}</div>` : ''
      return `
        <article class="comment-item" data-id="${escapeHtml(comment.id)}">
          <div class="comment-top">
            <div>
              <div class="comment-name">${escapeHtml(comment.name)}</div>
              <div class="comment-meta">${escapeHtml(formatDate(comment.createdAt))}</div>
            </div>
            <span class="comment-meta">${comment.reply ? 'تم الرد' : 'بانتظار الرد'}</span>
          </div>
          ${contact}
          <div class="comment-message">${escapeHtml(comment.message)}</div>
          ${existingReply}
          <form class="reply-form" data-comment-id="${escapeHtml(comment.id)}">
            <textarea name="reply" placeholder="اكتب رد المطور هنا">${escapeHtml(comment.reply?.text || '')}</textarea>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">حفظ الرد</button>
              <p class="form-status"></p>
            </div>
          </form>
        </article>
      `
    })
    .join('')

  document.querySelectorAll('.reply-form').forEach((form) => {
    form.addEventListener('submit', submitReply)
  })
}

async function loadComments() {
  const res = await adminFetch('/api/admin/comments')
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'تعذر تحميل التعليقات.')
  }
  renderComments(data.comments)
}

async function login(event) {
  event.preventDefault()
  const form = event.currentTarget
  const token = new FormData(form).get('token')
  setStatus('adminLoginStatus', 'جاري التحقق...')

  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const data = await res.json()

  if (!res.ok || !data.ok) {
    setStatus('adminLoginStatus', data.error || 'فشل تسجيل الدخول.', 'error')
    return
  }

  setToken(String(token || ''))
  setStatus('adminLoginStatus', 'تم تسجيل الدخول بنجاح.', 'success')
  await activatePanel()
}

async function submitReply(event) {
  event.preventDefault()
  const form = event.currentTarget
  const commentId = form.getAttribute('data-comment-id')
  const status = form.querySelector('.form-status')
  const reply = new FormData(form).get('reply')
  status.className = 'form-status'
  status.textContent = 'جاري الحفظ...'

  const res = await adminFetch(`/api/admin/comments/${commentId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply, by: 'المطور' }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    status.className = 'form-status error'
    status.textContent = data.error || 'تعذر حفظ الرد.'
    return
  }

  status.className = 'form-status success'
  status.textContent = 'تم حفظ الرد.'
  await loadComments()
}

async function activatePanel() {
  qs('adminPanel').classList.remove('hidden')
  await loadComments()
}

function logout() {
  clearToken()
  qs('adminPanel').classList.add('hidden')
}

async function init() {
  qs('adminLoginForm').addEventListener('submit', login)
  qs('adminLogout').addEventListener('click', logout)
  if (getToken()) {
    try {
      await activatePanel()
    } catch {
      clearToken()
    }
  }
}

init().catch((error) => {
  console.error(error)
})
