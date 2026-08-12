(function () {
  const form = document.getElementById('aiChatForm')
  const promptInput = document.getElementById('aiPrompt')
  const statusEl = document.getElementById('aiChatStatus')
  const messagesEl = document.getElementById('aiMessages')
  const particlesEl = document.getElementById('aiParticles')

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function setStatus(text, kind) {
    if (!statusEl) return
    statusEl.className = 'form-status ' + (kind || '')
    statusEl.textContent = text || ''
  }

  function scrollToBottom() {
    if (!messagesEl) return
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function appendMessage(role, text, label) {
    const article = document.createElement('article')
    article.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-bot')
    article.innerHTML =
      '<div class="ai-msg-badge">' + escapeHtml(label) + '</div>' +
      '<div class="ai-msg-bubble">' + escapeHtml(text).replace(/\n/g, '<br />') + '</div>'
    messagesEl.appendChild(article)
    scrollToBottom()
    return article
  }

  function setTyping(on) {
    const old = document.getElementById('aiTypingMsg')
    if (old) old.remove()
    if (!on) return
    const article = document.createElement('article')
    article.id = 'aiTypingMsg'
    article.className = 'ai-msg ai-msg-bot'
    article.innerHTML =
      '<div class="ai-msg-badge">Fares Bot AI</div>' +
      '<div class="ai-msg-bubble ai-typing-bubble"><span></span><span></span><span></span></div>'
    messagesEl.appendChild(article)
    scrollToBottom()
  }

  async function sendPrompt(prompt) {
    const clean = String(prompt || '').trim()
    if (!clean) {
      setStatus('اكتب سؤالك أولاً.', 'error')
      return
    }

    appendMessage('user', clean, 'أنت')
    promptInput.value = ''
    setStatus('جاري تجهيز الرد...', '')
    setTyping(true)

    try {
      const res = await fetch('/api/public/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean }),
      })
      const data = await res.json().catch(() => ({}))
      setTyping(false)
      if (!res.ok || !data.ok) {
        appendMessage('bot', data.error || 'تعذر الحصول على الرد حالياً.', 'Fares Bot AI')
        setStatus(data.error || 'تعذر الحصول على الرد.', 'error')
        return
      }
      appendMessage('bot', data.reply || 'تمت المعالجة لكن لم يتم إرجاع نص.', 'Fares Bot AI')
      setStatus('تم الرد بنجاح.', 'success')
    } catch (error) {
      setTyping(false)
      appendMessage('bot', 'حدث خطأ أثناء الاتصال بالمساعد. حاول مرة أخرى بعد قليل.', 'Fares Bot AI')
      setStatus('حدث خطأ أثناء الاتصال.', 'error')
    }
  }

  function createParticles() {
    if (!particlesEl) return
    const total = 24
    for (let i = 0; i < total; i++) {
      const span = document.createElement('span')
      span.className = 'ai-particle'
      span.style.left = Math.random() * 100 + '%'
      span.style.animationDelay = (Math.random() * 8).toFixed(2) + 's'
      span.style.animationDuration = (8 + Math.random() * 10).toFixed(2) + 's'
      span.style.opacity = (0.25 + Math.random() * 0.6).toFixed(2)
      particlesEl.appendChild(span)
    }
  }

  function bindSuggestions() {
    document.querySelectorAll('.ai-suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt') || ''
        promptInput.value = prompt
        promptInput.focus()
      })
    })
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      sendPrompt(promptInput.value)
    })
  }

  createParticles()
  bindSuggestions()
})()
