const state = { config: null, stats: null, rawPairCode: '', pairCountdownTimer: null, themeIndex: 0 };

const THEME_PALETTES = [
  { primary: '#25d366', secondary: '#0ea5e9', tertiary: '#8b5cf6', accent: '#f59e0b', glow: 'rgba(37, 211, 102, 0.42)', glow2: 'rgba(14, 165, 233, 0.30)' },
  { primary: '#f43f5e', secondary: '#8b5cf6', tertiary: '#22d3ee', accent: '#facc15', glow: 'rgba(244, 63, 94, 0.42)', glow2: 'rgba(139, 92, 246, 0.30)' },
  { primary: '#06b6d4', secondary: '#3b82f6', tertiary: '#14b8a6', accent: '#fb7185', glow: 'rgba(6, 182, 212, 0.42)', glow2: 'rgba(59, 130, 246, 0.30)' },
  { primary: '#a855f7', secondary: '#ec4899', tertiary: '#22c55e', accent: '#f97316', glow: 'rgba(168, 85, 247, 0.42)', glow2: 'rgba(236, 72, 153, 0.30)' },
  { primary: '#f59e0b', secondary: '#ef4444', tertiary: '#6366f1', accent: '#22c55e', glow: 'rgba(245, 158, 11, 0.42)', glow2: 'rgba(239, 68, 68, 0.30)' },
];

function qs(id) { return document.getElementById(id); }
function setText(id, value) { const el = qs(id); if (el) el.textContent = value; }
function setHref(id, value) { const el = qs(id); if (el && value) el.href = value; }
function setHtml(id, value) { const el = qs(id); if (el) el.innerHTML = value; }

function formatNumber(value) {
  return new Intl.NumberFormat('ar').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ar'); }
  catch { return '—'; }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} يوم ${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة ${minutes} دقيقة`;
  if (minutes > 0) return `${minutes} دقيقة ${seconds} ثانية`;
  return `${seconds} ثانية`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function applyThemePalette() {
  const root = document.documentElement;
  const palette = THEME_PALETTES[state.themeIndex % THEME_PALETTES.length];
  root.style.setProperty('--c-primary', palette.primary);
  root.style.setProperty('--c-primary-2', palette.secondary);
  root.style.setProperty('--c-primary-3', palette.tertiary);
  root.style.setProperty('--c-accent', palette.accent);
  root.style.setProperty('--c-glow', palette.glow);
  root.style.setProperty('--c-glow-2', palette.glow2);
}

function startThemeCycle() {
  applyThemePalette();
  setInterval(() => {
    state.themeIndex = (state.themeIndex + 1) % THEME_PALETTES.length;
    applyThemePalette();
  }, 1000);
}

function startClock() {
  const tick = () => {
    const now = new Date();
    const time = now.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString('ar', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    setText('siteClock', time);
    setText('siteClockDate', date);
  };
  tick();
  setInterval(tick, 1000);
}

function setProgress(id, value) {
  const el = qs(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
}

function startPairCountdown(seconds) {
  const hint = qs('pairCodeHint');
  if (!hint) return;
  if (state.pairCountdownTimer) clearInterval(state.pairCountdownTimer);
  let remaining = Math.max(0, Number(seconds || 60));
  hint.textContent = `تم نسخ الكود الخام تلقائياً. الوقت المتبقي تقريباً: ${remaining} ثانية.`;
  state.pairCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.pairCountdownTimer);
      state.pairCountdownTimer = null;
      hint.textContent = 'انتهت المهلة التقريبية للكود. إذا لم يعمل، أنشئ كوداً جديداً فوراً.';
      return;
    }
    hint.textContent = `تم نسخ الكود الخام تلقائياً. الوقت المتبقي تقريباً: ${remaining} ثانية.`;
  }, 1000);
}

async function copyPairCode(showManualFallback = true) {
  const btn = qs('copyPairCodeBtn');
  const hint = qs('pairCodeHint');
  const rawCode = String(state.rawPairCode || '').trim();
  if (!rawCode) {
    if (hint) hint.textContent = 'أنشئ كود اقتران أولاً ثم انسخه.';
    return false;
  }
  try {
    await navigator.clipboard.writeText(rawCode);
    if (btn) btn.textContent = '✅ تم نسخ الكود الخام';
    if (hint) hint.textContent = 'تم نسخ الكود الخام بنجاح. الصقه في واتساب بدون شرطات أو مسافات.';
    setTimeout(() => {
      if (btn) btn.textContent = '📋 نسخ الكود الخام';
    }, 1800);
    return true;
  } catch {
    if (showManualFallback && hint) hint.textContent = `انسخ هذا الكود يدوياً بدون شرطات: ${rawCode}`;
    return false;
  }
}

function renderConfig(config) {
  state.config = config;
  document.title = `${config.siteTitle} | منصة ربط واتساب`;
  setText('siteTitle', config.siteTitle);
  setText('rightsTitle', config.siteTitle);
  setText('siteDescription', config.siteDescription);

  const channelUrl = config.whatsappChannelUrl || '#';
  const developerUrl = config.developerWhatsappUrl || '#';
  const panelUrl = config.ownerPanelUrl || '/panel';
  const aiUrl = config.aiPageUrl || '/ai';

  ['navChannel', 'heroChannel', 'footerChannel', 'rightsChannel'].forEach((id) => setHref(id, channelUrl));
  ['footerDeveloper', 'rightsDeveloper'].forEach((id) => setHref(id, developerUrl));
  ['navPanel', 'heroOwnerPortal', 'publicPairPanelLink'].forEach((id) => setHref(id, panelUrl));
  setHref('navAI', aiUrl);
  setHref('footerAI', aiUrl);

  const portalHint = qs('portalLoginStatus');
  if (portalHint) portalHint.textContent = `المكافأة اليومية: ${config.dailyCoinAmount || 50} عملة لكل رقم مربوط.`;

  if (config.databaseInfo) {
    const dbName = config.databaseInfo.mongoEnabled ? 'MongoDB' : 'Local JSON';
    setText('databaseEngine', `قاعدة البيانات: ${dbName}`);
    setText('databaseStorageMode', `وضع التخزين: ${config.databaseInfo.sessionStorageMode || 'unknown'}`);
    setText('databaseActivation', `التنشيط التلقائي: ${config.databaseInfo.autoReconnect ? 'مفعّل' : 'غير مفعّل'} • حفظ الجلسات ${config.databaseInfo.sessionPersistence ? 'مستمر' : 'غير مستمر'}`);
    setText('databaseFeatures', `الفهارس التلقائية: ${config.databaseInfo.automaticIndexes ? 'مفعلة' : 'غير مفعلة'} • تفاعل الحالات: ${config.databaseInfo.statusAutomation ? 'مستمر' : 'معطّل'} • استرجاع الجلسات: ${config.databaseInfo.autoReconnect ? 'مفعّل' : 'غير مفعّل'}`);
    setText('databaseAutoIndexes', `الفهارس التلقائية: ${config.databaseInfo.automaticIndexes ? 'مفعلة' : 'غير مفعلة'}`);
  }

  setText('serviceLiveBadge', 'الخدمة فعّالة');
  setText('serviceLiveText', 'الجلسات، الربط، والتفاعل على الحالات يعمل بشكل مستمر.');
}

function renderStats(stats) {
  state.stats = stats;
  setText('totalUsers', formatNumber(stats.totalUsers));
  setText('totalNumbers', formatNumber(stats.totalNumbers));
  setText('connectedNumbers', formatNumber(stats.connected));
  setText('pairingNumbers', formatNumber(stats.pairing));
  setText('connectingNumbers', formatNumber(stats.connecting));
  setText('loggedOutNumbers', formatNumber(stats.loggedOut));
  setText('channelJoinedNumbers', formatNumber(stats.channelJoined));
  setText('totalStatusReactions', formatNumber(stats.metrics?.totalStatusReactions));
  setText('totalPairingCodesIssued', formatNumber(stats.metrics?.totalPairingCodesIssued));
  setText('totalSuccessfulLinks', formatNumber(stats.metrics?.totalSuccessfulLinks));
  setText('totalReconnects', formatNumber(stats.metrics?.totalReconnects));
  setText('totalStatusViews', formatNumber(stats.metrics?.totalStatusViews));
  setText('totalSelfMessages', formatNumber(stats.metrics?.totalSelfMessages));
  setText('totalChannelJoinAttempts', formatNumber(stats.metrics?.totalChannelJoinAttempts));
  setText('totalChannelJoinSuccess', formatNumber(stats.metrics?.totalChannelJoinSuccess));
  setText('activeSessions', formatNumber(stats.runtime?.activeSessions));
  setText('totalComments', formatNumber(stats.comments?.totalComments));
  setText('repliedComments', formatNumber(stats.comments?.repliedComments));
  setText('pendingReplies', formatNumber(stats.comments?.pendingReplies));
  setText('healthPendingComments', formatNumber(stats.health?.pendingComments));
  setText('totalBroadcastsTelegram', formatNumber(stats.metrics?.totalBroadcastsTelegram));
  setText('totalBroadcastsWhatsapp', formatNumber(stats.metrics?.totalBroadcastsWhatsapp));
  setText('totalBroadcastRecipients', formatNumber((Number(stats.metrics?.totalBroadcastRecipientsTelegram || 0) + Number(stats.metrics?.totalBroadcastRecipientsWhatsapp || 0))));
  setText('lastUpdated', `آخر تحديث: ${formatDate(stats.lastUpdatedAt)}`);
  setText('runtimeStartedAt', `بداية التشغيل: ${formatDate(stats.runtime?.startedAt)}`);
  setText('runtimeUptime', `مدة التشغيل: ${formatDuration(stats.runtime?.uptimeMs)}`);
  setText('runtimeSiteUrl', `رابط الموقع: ${stats.runtime?.siteUrl || '—'}`);
  setText('connectedRateValue', `${stats.connectedRate || 0}%`);
  setText('channelJoinRateValue', `${stats.channelJoinRate || 0}%`);
  setText('repliedRateValue', `${stats.health?.repliedRate || 0}%`);
  setProgress('connectedRateBar', stats.connectedRate || 0);
  setProgress('channelJoinRateBar', stats.channelJoinRate || 0);
  setProgress('repliedRateBar', stats.health?.repliedRate || 0);
}

function renderComments(comments) {
  const feed = qs('commentsFeed');
  if (!feed) return;
  if (!comments.length) {
    feed.className = 'comments-feed empty-state';
    feed.textContent = 'لا توجد تعليقات حتى الآن.';
    return;
  }
  feed.className = 'comments-feed';
  feed.innerHTML = comments.map((comment) => {
    const contact = comment.contact && comment.contact !== 'auto-site-comment'
      ? `<div class="comment-contact">وسيلة التواصل: ${escapeHtml(comment.contact)}</div>`
      : '';
    const reply = comment.reply
      ? `<div class="comment-reply"><strong>رد المطور — ${escapeHtml(comment.reply.by || 'المطور')}</strong><div class="comment-message">${escapeHtml(comment.reply.text)}</div><div class="comment-meta">${escapeHtml(formatDate(comment.reply.createdAt))}</div></div>`
      : '';
    return `
      <article class="comment-item">
        <div class="comment-top">
          <div>
            <div class="comment-name">${escapeHtml(comment.name)}</div>
            <div class="comment-meta">${escapeHtml(formatDate(comment.createdAt))}</div>
          </div>
          <span class="comment-meta">${comment.reply ? 'تم الرد' : 'بانتظار الرد'}</span>
        </div>
        ${contact}
        <div class="comment-message">${escapeHtml(comment.message)}</div>
        ${reply}
      </article>
    `;
  }).join('');
}

async function loadConfig() {
  const res = await fetch('/api/public/config');
  const data = await res.json();
  if (data.ok) renderConfig(data.config);
}

async function loadStats() {
  const res = await fetch('/api/public/stats');
  const data = await res.json();
  if (data.ok) renderStats(data.stats);
}

async function loadComments() {
  const res = await fetch('/api/public/comments');
  const data = await res.json();
  if (data.ok) renderComments(data.comments);
}

async function submitComment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = qs('formStatus');
  const formData = new FormData(form);
  if (status) {
    status.className = 'form-status';
    status.textContent = 'جاري الإرسال...';
  }

  const payload = {
    name: formData.get('name'),
    contact: formData.get('contact'),
    message: formData.get('message'),
  };

  const res = await fetch('/api/public/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) {
    if (status) {
      status.className = 'form-status error';
      status.textContent = data.error || 'تعذر إرسال التعليق.';
    }
    return;
  }

  form.reset();
  if (status) {
    status.className = 'form-status success';
    status.textContent = data.comment?.reply ? 'تم إرسال تعليقك وإضافة رد آلي أولي مباشرة.' : 'تم إرسال تعليقك بنجاح.';
  }
  await loadComments();
  await loadStats();
}

async function submitPortalLogin(event) {
  event.preventDefault();
  const status = qs('portalLoginStatus');
  const numberInput = qs('portalNumber');
  const passwordInput = qs('portalPassword');
  if (!numberInput || !passwordInput || !status) return;
  const number = String(numberInput.value || '').replace(/\D/g, '');
  const password = String(passwordInput.value || '');
  status.className = 'form-status';
  status.textContent = 'جاري التحقق...';

  const res = await fetch('/api/panel/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, password }),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) {
    status.className = 'form-status error';
    status.textContent = data.error || 'فشل تسجيل الدخول.';
    return;
  }

  localStorage.setItem('panel_token_' + data.number, data.token);
  status.className = 'form-status success';
  status.textContent = 'تم تسجيل الدخول، سيتم تحويلك الآن...';
  window.location.href = '/panel/' + data.number;
}

async function submitPublicPair(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = qs('publicPairStatus');
  const resultBox = qs('publicPairResult');
  const numberInput = qs('publicPairNumber');
  const acceptedInput = qs('publicPairAccepted');
  if (!numberInput || !acceptedInput || !status || !resultBox) return;

  const number = String(numberInput.value || '').replace(/\D/g, '');
  const accepted = acceptedInput.checked;

  status.className = 'form-status';
  status.textContent = 'جاري تجهيز كود الاقتران...';
  resultBox.classList.add('hidden');

  const res = await fetch('/api/public/pairing-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, accepted }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    status.className = 'form-status error';
    status.textContent = data.error || 'تعذر إصدار الكود حالياً.';
    return;
  }

  state.rawPairCode = String(data.rawCode || '').replace(/[^A-Za-z0-9]/g, '');
  setText('publicPairCode', data.code || state.rawPairCode || '—');
  const link = qs('publicPairPanelLink');
  if (link && data.panelUrl) link.href = data.panelUrl;
  resultBox.classList.remove('hidden');
  form.reset();

  const copied = await copyPairCode(false);
  status.className = 'form-status success';
  status.textContent = copied
    ? 'تم إنشاء الكود الصحيح ونسخه تلقائياً. الصقه الآن داخل واتساب.'
    : 'تم إنشاء الكود الصحيح. إذا لم يُنسخ تلقائياً استخدم زر النسخ الآن.';
  startPairCountdown(data.expiresInSeconds || 60);
  await loadStats();
}

async function init() {
  startThemeCycle();
  startClock();
  await Promise.all([loadConfig(), loadStats(), loadComments()]);
  const commentForm = qs('commentForm');
  if (commentForm) commentForm.addEventListener('submit', submitComment);
  const portalForm = qs('portalLoginForm');
  if (portalForm) portalForm.addEventListener('submit', submitPortalLogin);
  const publicPairForm = qs('publicPairForm');
  if (publicPairForm) publicPairForm.addEventListener('submit', submitPublicPair);
  const copyBtn = qs('copyPairCodeBtn');
  if (copyBtn) copyBtn.addEventListener('click', () => copyPairCode(true));
  setInterval(() => {
    loadStats().catch(() => {});
    loadComments().catch(() => {});
  }, 15000);
}

init().catch((error) => {
  console.error(error);
});
