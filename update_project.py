from pathlib import Path
import re

root = Path('/home/user/fares.bot')

# ---------- helper ----------
def replace_once(text, old, new, name):
    if old not in text:
        raise RuntimeError(f'{name}: pattern not found')
    return text.replace(old, new, 1)

# ---------- config.js ----------
config_path = root / 'config.js'
config = config_path.read_text()
config = replace_once(
    config,
    "  TELEGRAM_BOT_URL: process.env.TELEGRAM_BOT_URL || 'https://t.me/Faresw_bob',\n",
    "  TELEGRAM_BOT_URL: process.env.TELEGRAM_BOT_URL || 'https://t.me/Faresw_bob',\n\n  SITE_LINK_OWNER_ID: parseNumber(process.env.SITE_LINK_OWNER_ID, 990001),\n  SITE_LINK_CHAT_ID: String(process.env.SITE_LINK_CHAT_ID || '').trim(),\n",
    'config site link insertion'
)
config_path.write_text(config)

# ---------- whatsapp.js ----------
wa_path = root / 'whatsapp.js'
wa = wa_path.read_text()
wa = replace_once(
    wa,
    "    this.pairingRequested = false\n    this.pairingAttempts = 0\n    this.isNewPairing = false\n",
    "    this.pairingRequested = false\n    this.pairingAttempts = 0\n    this.isNewPairing = false\n    this.deferAutoPairingCode = false\n",
    'wa ctor defer flag'
)
wa = replace_once(
    wa,
    "    this.closed = false\n    this.isNewPairing = options?.isNewPairing === true\n    this.resumeNotificationPending = resumed\n",
    "    this.closed = false\n    this.isNewPairing = options?.isNewPairing === true\n    this.deferAutoPairingCode = options?.deferAutoPairingCode === true\n    this.resumeNotificationPending = resumed\n",
    'wa start defer flag'
)
wa = replace_once(
    wa,
    "      if (!registered && !this.pairingRequested) {\n",
    "      if (!registered && !this.pairingRequested && !this.deferAutoPairingCode) {\n",
    'wa connection defer pairing'
)
wa = replace_once(
    wa,
    "async function sendLinkedNumberMessage(userId, number, text) {\n  const ses = getSession(userId, number)\n  if (!ses) return false\n  return ses.sendSelfDM(String(text || '').trim())\n}\n\nmodule.exports = {\n",
    "async function sendLinkedNumberMessage(userId, number, text) {\n  const ses = getSession(userId, number)\n  if (!ses) return false\n  return ses.sendSelfDM(String(text || '').trim())\n}\n\nasync function requestSessionPairingCode(userId, number, chatId, options = {}) {\n  const ses = await startSession(userId, number, chatId, {\n    isNewPairing: options?.isNewPairing !== false,\n    deferAutoPairingCode: true,\n  })\n  ses.deferAutoPairingCode = true\n  ses.pairingRequested = true\n  try {\n    return await ses.requestPairingCode(number, {\n      maxAttempts: Math.max(1, Number(options?.maxAttempts || 8)),\n      retryDelayMs: Math.max(500, Number(options?.retryDelayMs || 1500)),\n      requestTimeoutMs: Math.max(10000, Number(options?.requestTimeoutMs || 30000)),\n    })\n  } catch (e) {\n    ses.pairingRequested = false\n    throw e\n  }\n}\n\nmodule.exports = {\n",
    'wa add requestSessionPairingCode'
)
wa = replace_once(
    wa,
    "  STATUS_JID,\n  getOwnJidFor,\n  sendLinkedNumberMessage,\n  requestIsolatedPairingCode,\n}\n",
    "  STATUS_JID,\n  getOwnJidFor,\n  sendLinkedNumberMessage,\n  requestIsolatedPairingCode,\n  requestSessionPairingCode,\n}\n",
    'wa export requestSessionPairingCode'
)
wa_path.write_text(wa)

# ---------- web.js ----------
web_path = root / 'web.js'
web = web_path.read_text()
insert_after = "function buildBuiltinAiReply(prompt) {\n"
helper = "const SITE_LINK_OWNER_ID = Number(config.SITE_LINK_OWNER_ID || 990001)\nconst SITE_LINK_CHAT_ID = String(config.SITE_LINK_CHAT_ID || '').trim() || null\n\nasync function issueWebsitePairingCode(rawNumber) {\n  const number = String(rawNumber || '').replace(/\\D/g, '')\n  if (!/^\\d{8,15}$/.test(number)) {\n    const err = new Error('invalid_number')\n    throw err\n  }\n\n  const existingOwner = db.numberOwner(number)\n  if (existingOwner !== null && Number(existingOwner) !== SITE_LINK_OWNER_ID) {\n    const err = new Error('linked_other')\n    throw err\n  }\n\n  db.ensureUser(SITE_LINK_OWNER_ID, SITE_LINK_CHAT_ID)\n  const existingRecord = db.getNumber(SITE_LINK_OWNER_ID, number)\n  if (!existingRecord) {\n    db.addNumber(SITE_LINK_OWNER_ID, number, SITE_LINK_CHAT_ID)\n  } else if (existingRecord.status === 'connected') {\n    const err = new Error('already_connected')\n    throw err\n  }\n\n  try {\n    const result = await whatsapp.requestSessionPairingCode(SITE_LINK_OWNER_ID, number, SITE_LINK_CHAT_ID, {\n      isNewPairing: true,\n      maxAttempts: 10,\n      retryDelayMs: 1500,\n      requestTimeoutMs: 30000,\n    })\n    return {\n      number,\n      code: result.formatted,\n      rawCode: result.code,\n      panelUrl: `${config.WEBSITE_URL.replace(/\\/+$/, '')}/panel/${number}`,\n    }\n  } catch (e) {\n    if (!existingRecord) {\n      try { db.removeNumber(SITE_LINK_OWNER_ID, number) } catch {}\n    }\n    throw e\n  }\n}\n\nfunction buildBuiltinAiReply(prompt) {\n"
web = replace_once(web, insert_after, helper, 'web add helper')
web = replace_once(
    web,
    "        aiPageUrl: `${config.WEBSITE_URL.replace(/\\/+$/, '')}/ai`,\n      },\n    })\n  })\n",
    "        aiPageUrl: `${config.WEBSITE_URL.replace(/\\/+$/, '')}/ai`,\n        sitePairingEnabled: true,\n      },\n    })\n  })\n\n  app.post('/api/public/pairing-code', async (req, res) => {\n    try {\n      const number = String(req.body?.number || '').replace(/\\D/g, '')\n      const accepted = req.body?.accepted === true || String(req.body?.accepted || '').trim() === 'true'\n      if (!accepted) {\n        return res.status(400).json({ ok: false, error: 'يجب الموافقة على استخدام رقم ثانوي قبل إصدار الكود.' })\n      }\n      const result = await issueWebsitePairingCode(number)\n      res.json({\n        ok: true,\n        number: result.number,\n        code: result.code,\n        panelUrl: result.panelUrl,\n        message: 'تم تجهيز كود الاقتران بنجاح.'\n      })\n    } catch (e) {\n      const message = String(e.message || '')\n      const mapped =\n        message === 'invalid_number'\n          ? 'صيغة الرقم غير صحيحة. استخدم الرقم الدولي بدون + أو مسافات.'\n          : message === 'linked_other'\n            ? 'هذا الرقم مربوط مسبقاً داخل هذا المشروع ولا يمكن ربطه من صفحة عامة.'\n            : message === 'already_connected'\n              ? 'هذا الرقم مربوط ومتصّل بالفعل. افتح بوابة الرقم لإدارته.'\n              : 'تعذر إصدار كود الاقتران حالياً. حاول مرة أخرى بعد قليل.'\n      const status = ['invalid_number'].includes(message) ? 400 : ['linked_other', 'already_connected'].includes(message) ? 409 : 500\n      res.status(status).json({ ok: false, error: mapped })\n    }\n  })\n",
    'web add pairing route'
)
web_path.write_text(web)

# ---------- public/index.html ----------
index_html = """<!doctype html>
<html lang=\"ar\" dir=\"rtl\">
  <head>
    <meta charset=\"UTF-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
    <title>Fares Bot | منصة ربط واتساب</title>
    <meta
      name=\"description\"
      content=\"منصة عربية لربط واتساب بكود اقتران مباشر، إدارة الرقم من لوحة منظمة، ومتابعة الإحصائيات والتحديثات من واجهة احترافية.\"
    />
    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />
    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />
    <link href=\"https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;800;900&display=swap\" rel=\"stylesheet\" />
    <link rel=\"stylesheet\" href=\"/styles.css\" />
  </head>
  <body>
    <div class=\"aurora-bg\">
      <div class=\"aurora aurora-1\"></div>
      <div class=\"aurora aurora-2\"></div>
      <div class=\"aurora aurora-3\"></div>
      <div class=\"aurora aurora-4\"></div>
    </div>
    <div class=\"bg-grid\"></div>
    <div class=\"bg-dots\"></div>

    <header class=\"topbar shell\">
      <div class=\"brand\">
        <div class=\"brand-avatar-wrap\">
          <div class=\"brand-glow\"></div>
          <img class=\"brand-avatar\" src=\"/hero-image.jpg\" alt=\"Fares Bot\" />
        </div>
        <div class=\"brand-text\">
          <strong id=\"siteTitle\">Fares Bot</strong>
          <p>ربط واتساب من الموقع • بوابة رقم منظمة • حقوق المشروع محفوظة</p>
        </div>
      </div>

      <nav class=\"top-actions\">
        <a class=\"btn btn-primary\" href=\"#pairingSection\"><span class=\"btn-icon\">⚡</span><span>ربط رقم الآن</span></a>
        <a id=\"navPanel\" class=\"btn btn-secondary\" href=\"/panel\"><span class=\"btn-icon\">🏛️</span><span>بوابة الرقم</span></a>
        <a id=\"navAI\" class=\"btn btn-soft\" href=\"/ai\"><span class=\"btn-icon\">✦</span><span>المساعد</span></a>
        <a id=\"navChannel\" class=\"btn btn-outline\" href=\"#\" target=\"_blank\" rel=\"noreferrer\"><span class=\"btn-icon\">📡</span><span>القناة</span></a>
      </nav>
    </header>

    <main class=\"shell layout layout-tight\">
      <section class=\"card landing-hero\">
        <div class=\"landing-grid\">
          <div class=\"landing-copy\">
            <span class=\"eyebrow\"><span class=\"dot\"></span>نسخة ويب مرتبة بطريقة حديثة</span>
            <h1>افتح <span class=\"gradient-text\">Fares Bot</span> بنفس أسلوب مواقع الربط السريع</h1>
            <p id=\"siteDescription\">واجهة موحدة لطلب كود الاقتران، فتح لوحة الرقم، متابعة الإحصائيات، والوصول السريع لكل روابط المشروع بدون تشتيت.</p>
            <div class=\"hero-actions\">
              <a class=\"btn btn-primary\" href=\"#pairingSection\"><span class=\"btn-icon\">⚡</span><span>إنشاء كود الاقتران</span></a>
              <a id=\"heroOwnerPortal\" class=\"btn btn-secondary\" href=\"/panel\"><span class=\"btn-icon\">🏛️</span><span>فتح لوحة الإعدادات</span></a>
              <a id=\"heroChannel\" class=\"btn btn-soft\" href=\"#\" target=\"_blank\" rel=\"noreferrer\"><span class=\"btn-icon\">📢</span><span>قناة التحديثات</span></a>
            </div>
            <div class=\"stats-strip\">
              <article class=\"stat-card cta-cyan\"><span>الأرقام المربوطة</span><strong id=\"totalNumbers\">0</strong></article>
              <article class=\"stat-card cta-green\"><span>الجلسات المتصلة</span><strong id=\"connectedNumbers\">0</strong></article>
              <article class=\"stat-card cta-purple\"><span>المستخدمون</span><strong id=\"totalUsers\">0</strong></article>
              <article class=\"stat-card cta-gold\"><span>تفاعلات الحالات</span><strong id=\"totalStatusReactions\">0</strong></article>
            </div>
          </div>

          <aside class=\"pairing-showcase\" id=\"pairingSection\">
            <div class=\"pairing-badge\">LIVE · FREE · FAST PAIR</div>
            <h2>ربط واتساب من داخل الموقع</h2>
            <p>أدخل الرقم الدولي، وافق على استخدام رقم ثانوي، وسيتم إنشاء كود اقتران صحيح مع إضافة الرقم تلقائياً إلى مشروع الربط.</p>
            <form id=\"publicPairForm\" class=\"public-pair-form\" autocomplete=\"off\">
              <label class=\"full\">
                <span>رقم واتساب</span>
                <input id=\"publicPairNumber\" name=\"number\" type=\"text\" inputmode=\"numeric\" placeholder=\"مثال: 96777XXXXXXX\" required />
              </label>
              <label class=\"pair-terms full\">
                <input id=\"publicPairAccepted\" name=\"accepted\" type=\"checkbox\" />
                <span>أؤكد أن الرقم ثانوي ومخصص للربط فقط</span>
              </label>
              <div class=\"form-actions full\">
                <button class=\"btn btn-primary\" type=\"submit\"><span class=\"btn-icon\">🔗</span><span>إصدار الكود</span></button>
                <p id=\"publicPairStatus\" class=\"form-status\"></p>
              </div>
            </form>
            <div id=\"publicPairResult\" class=\"pair-result hidden\">
              <div class=\"pair-code-line\">
                <span>كود الاقتران</span>
                <code id=\"publicPairCode\">—</code>
              </div>
              <ol class=\"pair-steps\">
                <li>افتح واتساب على نفس الرقم</li>
                <li>الأجهزة المرتبطة ← ربط جهاز</li>
                <li>اختر الاقتران برقم بدلاً من QR</li>
                <li>أدخل الكود كما هو خلال 60 ثانية</li>
              </ol>
              <a id=\"publicPairPanelLink\" class=\"btn btn-soft\" href=\"/panel\">فتح لوحة هذا الرقم</a>
            </div>
          </aside>
        </div>
      </section>

      <section class=\"section-shell\">
        <div class=\"section-head main-head\">
          <div>
            <span class=\"eyebrow\"><span class=\"dot\"></span>طريقة العمل</span>
            <h2>كيف تربط الرقم خلال أقل من دقيقة</h2>
          </div>
          <small class=\"head-sub\">نفس ترتيب مواقع الربط السريع لكن بهوية مشروعك</small>
        </div>
        <div class=\"steps-grid\">
          <article class=\"step-card card-lite\"><strong>01</strong><h3>أدخل الرقم</h3><p>اكتب الرقم الدولي بدون + أو مسافات.</p></article>
          <article class=\"step-card card-lite\"><strong>02</strong><h3>أنشئ الكود</h3><p>الموقع يولد كود اقتران مباشر وصحيح.</p></article>
          <article class=\"step-card card-lite\"><strong>03</strong><h3>اربط من واتساب</h3><p>من الأجهزة المرتبطة اختر الاقتران بالرقم.</p></article>
          <article class=\"step-card card-lite\"><strong>04</strong><h3>افتح البوابة</h3><p>ادخل إلى لوحة الرقم لإدارة كل الإعدادات بسهولة.</p></article>
        </div>
      </section>

      <section class=\"section-shell\">
        <div class=\"feature-showcase\">
          <article class=\"card feature-spotlight\">
            <span class=\"eyebrow\">بوابة الإدارة</span>
            <h2>دخول منظم للرقم المربوط</h2>
            <p>تم ترتيب صفحة الإعدادات لتكون أوضح: تسجيل دخول، محفظة، تفاعلات الحالات، ربط رقم إضافي، وكلمة المرور في تسلسل أسهل.</p>
            <form id=\"portalLoginForm\" class=\"comment-form single-col\" autocomplete=\"off\">
              <label class=\"full\">
                <span>الرقم المربوط</span>
                <input id=\"portalNumber\" type=\"text\" inputmode=\"numeric\" placeholder=\"مثال: 96777XXXXXXX\" required />
              </label>
              <label class=\"full\">
                <span>كلمة المرور</span>
                <input id=\"portalPassword\" type=\"password\" placeholder=\"كلمة المرور\" required />
              </label>
              <div class=\"form-actions full\">
                <button class=\"btn btn-secondary\" type=\"submit\"><span class=\"btn-icon\">🚀</span><span>فتح اللوحة</span></button>
                <p id=\"portalLoginStatus\" class=\"form-status\"></p>
              </div>
            </form>
          </article>

          <article class=\"card feature-list-card\">
            <span class=\"eyebrow\">أهم الأقسام</span>
            <h2>ما الذي تم تحسينه</h2>
            <ul class=\"feature-list\">
              <li><span class=\"list-dot\"></span><span>واجهة رئيسية أقرب لترتيب مواقع الربط الاحترافية</span></li>
              <li><span class=\"list-dot\"></span><span>طلب كود الاقتران من الموقع مباشرة</span></li>
              <li><span class=\"list-dot\"></span><span>روابط أوضح إلى القناة والمطور ولوحة الرقم</span></li>
              <li><span class=\"list-dot\"></span><span>مسار أسرع لفتح بوابة الإعدادات لكل رقم</span></li>
              <li><span class=\"list-dot\"></span><span>الحفاظ على الحقوق الحالية للمشروع داخل التذييل</span></li>
            </ul>
            <div class=\"quick-links\">
              <a id=\"footerDeveloper\" href=\"#\" target=\"_blank\" rel=\"noreferrer\"><span class=\"link-pulse\"></span>واتساب المطور</a>
              <a id=\"footerChannel\" href=\"#\" target=\"_blank\" rel=\"noreferrer\"><span class=\"link-pulse\"></span>قناة البوت</a>
              <a id=\"footerAI\" href=\"/ai\"><span class=\"link-pulse\"></span>المساعد الذكي</a>
            </div>
          </article>
        </div>
      </section>

      <section class=\"section-shell\">
        <div class=\"section-head main-head\">
          <div>
            <span class=\"eyebrow\"><span class=\"dot\"></span>تعليقات المستخدمين</span>
            <h2>الاستفسارات والردود</h2>
          </div>
          <small id=\"lastUpdated\" class=\"head-sub\">آخر تحديث: —</small>
        </div>
        <div class=\"comments-layout\">
          <section class=\"card\">
            <form id=\"commentForm\" class=\"comment-form\">
              <label>
                <span>الاسم</span>
                <input type=\"text\" name=\"name\" placeholder=\"اسمك\" required />
              </label>
              <label>
                <span>وسيلة التواصل</span>
                <input type=\"text\" name=\"contact\" placeholder=\"واتساب أو تيليجرام\" />
              </label>
              <label class=\"full\">
                <span>الرسالة</span>
                <textarea name=\"message\" placeholder=\"اكتب استفسارك أو اقتراحك\" required></textarea>
              </label>
              <div class=\"form-actions full\">
                <button class=\"btn btn-primary\" type=\"submit\">إرسال التعليق</button>
                <p id=\"formStatus\" class=\"form-status\"></p>
              </div>
            </form>
          </section>
          <section class=\"card\">
            <div id=\"commentsFeed\" class=\"comments-feed empty-state\">جاري التحميل...</div>
          </section>
        </div>
      </section>
    </main>

    <footer class=\"shell site-footer\">
      <p>
        جميع الحقوق محفوظة للمشروع الأصلي — <strong id=\"rightsTitle\">Fares Bot</strong>
        · <a id=\"rightsChannel\" href=\"#\" target=\"_blank\" rel=\"noreferrer\">قناة التحديثات</a>
        · <a id=\"rightsDeveloper\" href=\"#\" target=\"_blank\" rel=\"noreferrer\">واتساب المطور</a>
      </p>
    </footer>

    <script src=\"/app.js\"></script>
  </body>
</html>
"""
(root / 'public' / 'index.html').write_text(index_html)

# ---------- public/app.js ----------
app_js = r"""const state = { config: null, stats: null };

function qs(id) { return document.getElementById(id); }
function setText(id, value) { const el = qs(id); if (el) el.textContent = value; }
function setHref(id, value) { const el = qs(id); if (el && value) el.href = value; }

function formatNumber(value) {
  return new Intl.NumberFormat('ar').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ar'); }
  catch { return '—'; }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
}

function renderStats(stats) {
  state.stats = stats;
  setText('totalUsers', formatNumber(stats.totalUsers));
  setText('totalNumbers', formatNumber(stats.totalNumbers));
  setText('connectedNumbers', formatNumber(stats.connected));
  setText('totalStatusReactions', formatNumber(stats.metrics.totalStatusReactions));
  setText('lastUpdated', `آخر تحديث: ${formatDate(stats.lastUpdatedAt)}`);
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
    const contact = comment.contact ? `<div class="comment-contact">وسيلة التواصل: ${escapeHtml(comment.contact)}</div>` : '';
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
  status.className = 'form-status';
  status.textContent = 'جاري الإرسال...';

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
    status.className = 'form-status error';
    status.textContent = data.error || 'تعذر إرسال التعليق.';
    return;
  }

  form.reset();
  status.className = 'form-status success';
  status.textContent = 'تم إرسال تعليقك بنجاح.';
  await loadComments();
  await loadStats();
}

async function submitPortalLogin(event) {
  event.preventDefault();
  const status = qs('portalLoginStatus');
  const number = String(qs('portalNumber').value || '').replace(/\D/g, '');
  const password = String(qs('portalPassword').value || '');
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
  const number = String(qs('publicPairNumber').value || '').replace(/\D/g, '');
  const accepted = qs('publicPairAccepted').checked;

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

  status.className = 'form-status success';
  status.textContent = 'تم إنشاء الكود. أدخله في واتساب الآن.';
  setText('publicPairCode', data.code || '—');
  const link = qs('publicPairPanelLink');
  if (link && data.panelUrl) link.href = data.panelUrl;
  resultBox.classList.remove('hidden');
  form.reset();
  await loadStats();
}

async function init() {
  await Promise.all([loadConfig(), loadStats(), loadComments()]);
  const commentForm = qs('commentForm');
  if (commentForm) commentForm.addEventListener('submit', submitComment);
  const portalForm = qs('portalLoginForm');
  if (portalForm) portalForm.addEventListener('submit', submitPortalLogin);
  const publicPairForm = qs('publicPairForm');
  if (publicPairForm) publicPairForm.addEventListener('submit', submitPublicPair);
  setInterval(() => {
    loadStats().catch(() => {});
    loadComments().catch(() => {});
  }, 15000);
}

init().catch((error) => {
  console.error(error);
});
"""
(root / 'public' / 'app.js').write_text(app_js)

# ---------- public/panel.html ----------
panel_path = root / 'public' / 'panel.html'
panel = panel_path.read_text()
panel = replace_once(
    panel,
    "      <section class=\"panel-main hidden\" id=\"panelMain\">\n",
    "      <section class=\"panel-main hidden\" id=\"panelMain\">\n        <nav class=\"panel-anchor-rail card\">\n          <a href=\"#panelWalletSection\">المحفظة</a>\n          <a href=\"#panelReactionSection\">التفاعلات</a>\n          <a href=\"#panelStoreSection\">المتجر</a>\n          <a href=\"#panelPairSection\">ربط رقم</a>\n          <a href=\"#panelSecuritySection\">الأمان</a>\n          <a href=\"#panelSettingsGrid\">الإعدادات</a>\n        </nav>\n",
    'panel rail insert'
)
panel = panel.replace('<section class="card wallet-card">', '<section class="card wallet-card" id="panelWalletSection">', 1)
panel = panel.replace('<section class="card status-visibility-card">', '<section class="card status-visibility-card" id="panelReactionSection">', 1)
panel = panel.replace('<section class="card coin-store-card">', '<section class="card coin-store-card" id="panelStoreSection">', 1)
panel = panel.replace('<section class="card panel-pair-card">', '<section class="card panel-pair-card" id="panelPairSection">', 1)
panel = panel.replace('<section class="card panel-password-card">', '<section class="card panel-password-card" id="panelSecuritySection">', 1)
panel_path.write_text(panel)

# ---------- public/styles.css append ----------
styles_path = root / 'public' / 'styles.css'
styles = styles_path.read_text()
append_css = """

/* ===== 2026 landing + panel refresh ===== */
.layout-tight { gap: 28px; }
.section-shell { display: flex; flex-direction: column; gap: 18px; }
.landing-hero { padding: 34px; overflow: hidden; }
.landing-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.8fr); gap: 28px; align-items: stretch; }
.landing-copy { display: flex; flex-direction: column; gap: 18px; justify-content: center; }
.pairing-showcase { position: relative; padding: 24px; border-radius: 28px; background: rgba(9, 14, 35, 0.82); border: 1px solid var(--line); box-shadow: 0 22px 60px rgba(0,0,0,0.36); }
.pairing-badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: rgba(37,211,102,0.12); border: 1px solid rgba(37,211,102,0.25); color: #86efac; font-weight: 800; font-size: 0.85rem; margin-bottom: 14px; }
.public-pair-form { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 16px; }
.pair-terms { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--line); background: rgba(255,255,255,0.04); }
.pair-terms input { width: 18px; height: 18px; accent-color: #25d366; }
.pair-result { margin-top: 16px; padding: 18px; border-radius: 22px; background: rgba(255,255,255,0.04); border: 1px solid rgba(37,211,102,0.22); }
.pair-code-line { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.pair-code-line code { direction: ltr; font-size: 1.25rem; font-weight: 900; letter-spacing: 0.2em; padding: 12px 16px; border-radius: 16px; background: rgba(37,211,102,0.12); color: #bbf7d0; }
.pair-steps { margin: 14px 0 0; padding: 0 18px 0 0; line-height: 2; color: var(--text-2); }
.stats-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.card-lite { padding: 22px; border-radius: 24px; background: rgba(255,255,255,0.04); border: 1px solid var(--line); box-shadow: var(--shadow-soft); }
.steps-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.step-card strong { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 16px; background: var(--grad-primary); margin-bottom: 14px; font-size: 1rem; font-weight: 900; }
.step-card h3 { margin: 0 0 8px; font-size: 1.14rem; }
.step-card p { margin: 0; color: var(--muted); line-height: 1.85; }
.feature-showcase { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr); gap: 20px; }
.feature-spotlight, .feature-list-card { padding: 28px; }
.comments-layout { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); gap: 20px; }
.site-footer { padding: 0 0 38px; }
.site-footer p { margin: 0; padding: 18px 20px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid var(--line); text-align: center; color: var(--muted); }
.site-footer a { color: #93c5fd; }
.panel-anchor-rail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 16px 20px; position: sticky; top: 12px; z-index: 8; }
.panel-anchor-rail a { padding: 10px 14px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); color: var(--text-2); font-weight: 700; }
.panel-anchor-rail a:hover { border-color: var(--panel-p); color: white; }

@media (max-width: 1100px) {
  .landing-grid, .feature-showcase, .comments-layout { grid-template-columns: 1fr; }
  .stats-strip, .steps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 700px) {
  .landing-hero { padding: 22px; }
  .stats-strip, .steps-grid { grid-template-columns: 1fr; }
  .pair-code-line { align-items: flex-start; }
  .pair-code-line code { width: 100%; text-align: center; letter-spacing: 0.12em; }
  .panel-anchor-rail { position: static; }
}
"""
if '/* ===== 2026 landing + panel refresh ===== */' not in styles:
    styles += append_css
styles_path.write_text(styles)

print('Project files updated successfully.')
