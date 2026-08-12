from pathlib import Path
import re

root = Path('/home/user/fares.bot')
public = root / 'public'

shared_page = '''<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <meta
      name="description"
      content="واجهة عربية متكاملة لربط واتساب، استخراج كود الاقتران، متابعة الإحصائيات، التعليقات، وحالة قاعدة البيانات والجلسات في مشروع Fares Bot."
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="aurora-bg">
      <div class="aurora aurora-1"></div>
      <div class="aurora aurora-2"></div>
      <div class="aurora aurora-3"></div>
      <div class="aurora aurora-4"></div>
    </div>
    <div class="bg-grid"></div>
    <div class="bg-dots"></div>
    <div class="bg-orb orb-1"></div>
    <div class="bg-orb orb-2"></div>

    <section class="shell welcome-marquee-shell">
      <div class="welcome-marquee">
        <div class="welcome-track">
          <span>أهلاً وسهلاً ✦ نورت موقع فارس ✦ أهلاً وسهلاً ✦ نورت موقع فارس ✦ أهلاً وسهلاً ✦ نورت موقع فارس</span>
          <span>أهلاً وسهلاً ✦ نورت موقع فارس ✦ أهلاً وسهلاً ✦ نورت موقع فارس ✦ أهلاً وسهلاً ✦ نورت موقع فارس</span>
        </div>
      </div>
    </section>

    <header class="topbar shell">
      <div class="brand">
        <div class="brand-avatar-wrap">
          <div class="brand-glow"></div>
          <img class="brand-avatar" src="/hero-image.jpg" alt="Fares Bot" />
        </div>
        <div class="brand-text">
          <strong id="siteTitle">Fares Bot</strong>
          <p>موقع البوت — ربط واتساب — تعليقات — إحصائيات — قاعدة بيانات فعّالة</p>
        </div>
      </div>

      <nav class="top-actions">
        <a class="btn btn-primary" href="/bot/deploy"><span class="btn-icon">⚡</span><span>ربط رقمك الآن</span></a>
        <a class="btn btn-soft" href="#commentsSection"><span class="btn-icon">💬</span><span>قسم التعليقات</span></a>
        <a id="navPanel" class="btn btn-secondary" href="/panel"><span class="btn-icon">🏛️</span><span>بوابة الرقم</span></a>
        <a id="navAI" class="btn btn-soft" href="/ai"><span class="btn-icon">✦</span><span>المساعد</span></a>
        <a id="navChannel" class="btn btn-outline" href="#" target="_blank" rel="noreferrer"><span class="btn-icon">📡</span><span>القناة</span></a>
      </nav>
    </header>

    <main class="shell layout layout-tight">
      <section class="card landing-hero">
        <div class="landing-grid">
          <div class="landing-copy">
            <span class="eyebrow"><span class="dot"></span>الخدمة فعّالة الآن وتعمل بالألوان المتحركة</span>
            <h1>
              <span class="gradient-text">أهلاً وسهلاً نورت موقع فارس</span>
              <br />
              منصة ربط رقمك وإدارة بوتك بشكل كامل
            </h1>
            <p id="siteDescription">من هنا تقدر تفتح صفحة ربط الرقم الصحيحة، تطلب كود الاقتران، تتابع الإحصائيات الكاملة، تشاهد حالة قاعدة البيانات، وتضيف تعليقك مع رد تلقائي مباشر.</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="/bot/deploy"><span class="btn-icon">🔗</span><span>فتح صفحة الرقم</span></a>
              <a id="heroOwnerPortal" class="btn btn-secondary" href="/panel"><span class="btn-icon">⚙️</span><span>فتح لوحة الإعدادات</span></a>
              <a class="btn btn-soft" href="#databaseSection"><span class="btn-icon">🗄️</span><span>معلومات قاعدة البيانات</span></a>
            </div>
            <div class="whatsapp-showcase">
              <article class="wa-card wa-official">
                <div class="wa-icon">🕒</div>
                <div>
                  <strong id="siteClock">00:00:00</strong>
                  <p id="siteClockDate">جاري تحميل الوقت...</p>
                </div>
              </article>
              <article class="wa-card wa-business">
                <div class="wa-icon">✅</div>
                <div>
                  <strong id="serviceLiveBadge">الخدمة فعّالة</strong>
                  <p id="serviceLiveText">الجلسات، الربط، والتفاعل على الحالات يعمل بشكل مستمر.</p>
                </div>
              </article>
              <article class="wa-card wa-classic">
                <div class="wa-icon">🗄️</div>
                <div>
                  <strong id="databaseEngine">قاعدة البيانات: جار التحميل</strong>
                  <p id="databaseStorageMode">وضع التخزين: جار التحميل</p>
                </div>
              </article>
            </div>
          </div>

          <aside class="pairing-showcase" id="pairingSection">
            <div class="pairing-badge">LIVE · PAIR · AUTO COPY</div>
            <h2>ربط الرقم من داخل الموقع مباشرة</h2>
            <p>أدخل الرقم الدولي واضغط طلب الكود. إذا تم إنشاء كود الاقتران فسيظهر لك بشكل صحيح ويتم نسخ الكود الخام تلقائياً مباشرة.</p>
            <form id="publicPairForm" class="public-pair-form" autocomplete="off">
              <label class="full">
                <span>رقم واتساب</span>
                <input id="publicPairNumber" name="number" type="text" inputmode="numeric" placeholder="مثال: 96777XXXXXXX" required />
              </label>
              <label class="pair-terms full">
                <input id="publicPairAccepted" name="accepted" type="checkbox" />
                <span>أؤكد أن الرقم ثانوي ومخصص للربط فقط</span>
              </label>
              <div class="form-actions full">
                <button class="btn btn-primary" type="submit"><span class="btn-icon">🔗</span><span>طلب كود الاقتران</span></button>
                <p id="publicPairStatus" class="form-status"></p>
              </div>
            </form>
            <div id="publicPairResult" class="pair-result hidden">
              <div class="pair-code-line">
                <span>كود الاقتران</span>
                <code id="publicPairCode">—</code>
              </div>
              <div class="pair-copy-row">
                <button id="copyPairCodeBtn" class="btn btn-soft" type="button">📋 نسخ الكود الخام</button>
                <p id="pairCodeHint" class="hint-line">سيتم نسخ الكود الخام تلقائياً بعد إنشائه.</p>
              </div>
              <ol class="pair-steps">
                <li>افتح واتساب على نفس الرقم</li>
                <li>الأجهزة المرتبطة ← ربط جهاز</li>
                <li>اختر الاقتران برقم بدلاً من QR</li>
                <li>الصق الكود المنسوخ مباشرة خلال المهلة</li>
              </ol>
              <a id="publicPairPanelLink" class="btn btn-soft" href="/panel">فتح لوحة هذا الرقم</a>
            </div>
          </aside>
        </div>
      </section>

      <section class="section-shell">
        <div class="section-head main-head">
          <div>
            <span class="eyebrow"><span class="dot"></span>الإحصائيات الكاملة</span>
            <h2>كل أرقام وإحصائيات البوت أمامك مباشرة</h2>
          </div>
          <small id="lastUpdated" class="head-sub">آخر تحديث: —</small>
        </div>
        <div class="stats-grid bot-stats-grid">
          <article class="stat-card cta-cyan"><span>المستخدمون</span><strong id="totalUsers">0</strong></article>
          <article class="stat-card cta-green"><span>الأرقام المربوطة</span><strong id="totalNumbers">0</strong></article>
          <article class="stat-card cta-purple"><span>الجلسات المتصلة</span><strong id="connectedNumbers">0</strong></article>
          <article class="stat-card cta-gold"><span>قيد الاقتران</span><strong id="pairingNumbers">0</strong></article>
          <article class="stat-card cta-orange"><span>قيد الاتصال</span><strong id="connectingNumbers">0</strong></article>
          <article class="stat-card cta-red"><span>مسجل خروجها</span><strong id="loggedOutNumbers">0</strong></article>
          <article class="stat-card cta-blue"><span>المنضمّة للقناة</span><strong id="channelJoinedNumbers">0</strong></article>
          <article class="stat-card cta-pink"><span>تفاعلات الحالات</span><strong id="totalStatusReactions">0</strong></article>
          <article class="stat-card cta-cyan"><span>أكواد الاقتران</span><strong id="totalPairingCodesIssued">0</strong></article>
          <article class="stat-card cta-green"><span>الربط الناجح</span><strong id="totalSuccessfulLinks">0</strong></article>
          <article class="stat-card cta-purple"><span>إعادة الاتصال</span><strong id="totalReconnects">0</strong></article>
          <article class="stat-card cta-gold"><span>مشاهدات الحالات</span><strong id="totalStatusViews">0</strong></article>
          <article class="stat-card cta-orange"><span>رسائل واتساب الذاتية</span><strong id="totalSelfMessages">0</strong></article>
          <article class="stat-card cta-red"><span>محاولات الانضمام للقناة</span><strong id="totalChannelJoinAttempts">0</strong></article>
          <article class="stat-card cta-blue"><span>نجاحات الانضمام للقناة</span><strong id="totalChannelJoinSuccess">0</strong></article>
          <article class="stat-card cta-pink"><span>الجلسات النشطة الآن</span><strong id="activeSessions">0</strong></article>
          <article class="stat-card cta-cyan"><span>إجمالي التعليقات</span><strong id="totalComments">0</strong></article>
          <article class="stat-card cta-green"><span>تعليقات مردود عليها</span><strong id="repliedComments">0</strong></article>
          <article class="stat-card cta-orange"><span>تعليقات بانتظار الرد</span><strong id="pendingReplies">0</strong></article>
        </div>
      </section>

      <section class="section-shell">
        <div class="section-head main-head">
          <div>
            <span class="eyebrow"><span class="dot"></span>أقسام موقع البوت</span>
            <h2>الأقسام الآن مرتبة بشكل عمودي وواضح</h2>
          </div>
          <small class="head-sub">كل قسم في بطاقة عمودية مستقلة</small>
        </div>
        <div class="vertical-cards bot-vertical-single">
          <article class="vcard">
            <div class="vcard-number">01</div>
            <div class="vcard-icon-wrap"><span class="vcard-icon">🔗</span></div>
            <div class="vcard-body">
              <span class="vcard-eyebrow">ربط الرقم</span>
              <h3>صفحة ربط الرقم الصحيحة</h3>
              <p>تم تصحيح المسار حتى لما تضغط «فتح صفحة الرقم» يفتح لك صفحة ربط الرقم الفعلية بدل ما يرجعك للصفحة الرئيسية.</p>
              <a class="feature-link feature-link-accent" href="/bot/deploy"><span class="link-bullet"></span><div><span>الدخول المباشر</span><strong>فتح صفحة الرقم وطلب الكود الآن</strong></div></a>
            </div>
          </article>

          <article class="vcard">
            <div class="vcard-number">02</div>
            <div class="vcard-icon-wrap"><span class="vcard-icon">💬</span></div>
            <div class="vcard-body">
              <span class="vcard-eyebrow">التعليقات</span>
              <h3>قسم تعليقات داخل الموقع</h3>
              <p>تمت إضافة قسم تعليقات واضح داخل الموقع، وعند إرسال أي تعليق يتم إدراج رد تلقائي أولي عليه مباشرة.</p>
              <a class="feature-link" href="#commentsSection"><span class="link-bullet"></span><div><span>الانتقال السريع</span><strong>اذهب مباشرة إلى قسم التعليقات</strong></div></a>
            </div>
          </article>

          <article class="vcard">
            <div class="vcard-number">03</div>
            <div class="vcard-icon-wrap"><span class="vcard-icon">⚙️</span></div>
            <div class="vcard-body">
              <span class="vcard-eyebrow">الإدارة</span>
              <h3>لوحة الرقم والإعدادات</h3>
              <p>من لوحة الرقم تقدر تدخل على الإعدادات، المحفظة، سجل التفاعلات، الأمان، وربط أرقام إضافية من نفس المكان.</p>
              <a class="feature-link" href="/panel"><span class="link-bullet"></span><div><span>لوحة الإدارة</span><strong>فتح بوابة الرقم</strong></div></a>
            </div>
          </article>

          <article class="vcard">
            <div class="vcard-number">04</div>
            <div class="vcard-icon-wrap"><span class="vcard-icon">🗄️</span></div>
            <div class="vcard-body">
              <span class="vcard-eyebrow">الجلسات وقاعدة البيانات</span>
              <h3>استمرارية العمل والتفاعل على الحالات</h3>
              <p>الموقع يعرض لك أن الجلسات والبيانات مخزنة بشكل دائم، مع إعادة اتصال تلقائية ومتابعة للحالات حتى تبقى الأرقام المربوطة شغّالة بشكل مستمر.</p>
              <a class="feature-link" href="#databaseSection"><span class="link-bullet"></span><div><span>المزيد من المعلومات</span><strong>افتح قسم قاعدة البيانات والاستمرارية</strong></div></a>
            </div>
          </article>
        </div>
      </section>

      <section class="section-shell" id="databaseSection">
        <div class="feature-showcase">
          <article class="card feature-spotlight">
            <span class="eyebrow">معلومات قاعدة البيانات</span>
            <h2>قاعدة البيانات والجلسات مفعلة تلقائياً</h2>
            <p>هذا القسم يوضح حالة قاعدة البيانات، طريقة حفظ الجلسات، تفعيل الفهارس تلقائياً، واستمرار الأرقام المربوطة في العمل والتفاعل على حالات واتساب.</p>
            <div class="mini-note-box">
              <strong id="databaseActivation">التنشيط التلقائي: جار التحميل</strong>
              <p id="databaseFeatures">استعادة الجلسات، إعادة الاتصال، وتخزين البيانات الدائم يتم تفعيله تلقائياً داخل المشروع.</p>
            </div>
            <ul class="feature-list">
              <li><span class="list-dot"></span><span id="runtimeStartedAt">بداية التشغيل: —</span></li>
              <li><span class="list-dot"></span><span id="runtimeUptime">مدة التشغيل: —</span></li>
              <li><span class="list-dot"></span><span id="runtimeSiteUrl">رابط الموقع: —</span></li>
              <li><span class="list-dot"></span><span id="databaseAutoIndexes">الفهارس التلقائية: مفعلة</span></li>
            </ul>
          </article>

          <article class="card feature-list-card">
            <span class="eyebrow">مؤشرات الصحة</span>
            <h2>نِسَب الاستقرار والتفاعل</h2>
            <div class="progress-wrap">
              <div class="progress-card">
                <div class="label-row"><span>نسبة الاتصال</span><strong id="connectedRateValue">0%</strong></div>
                <div class="progress-bar"><i id="connectedRateBar"></i></div>
              </div>
              <div class="progress-card">
                <div class="label-row"><span>نسبة الانضمام للقناة</span><strong id="channelJoinRateValue">0%</strong></div>
                <div class="progress-bar"><i id="channelJoinRateBar" class="bar-success"></i></div>
              </div>
              <div class="progress-card">
                <div class="label-row"><span>نسبة الرد على التعليقات</span><strong id="repliedRateValue">0%</strong></div>
                <div class="progress-bar"><i id="repliedRateBar"></i></div>
              </div>
            </div>
            <div class="stats-grid bot-mini-stats-grid">
              <article class="stat-card cta-green"><span>التعليقات المعلقة</span><strong id="healthPendingComments">0</strong></article>
              <article class="stat-card cta-purple"><span>الردود الجماعية تيليجرام</span><strong id="totalBroadcastsTelegram">0</strong></article>
              <article class="stat-card cta-cyan"><span>الردود الجماعية واتساب</span><strong id="totalBroadcastsWhatsapp">0</strong></article>
              <article class="stat-card cta-gold"><span>مستلمي البث</span><strong id="totalBroadcastRecipients">0</strong></article>
            </div>
          </article>
        </div>
      </section>

      <section class="section-shell" id="commentsSection">
        <div class="section-head main-head">
          <div>
            <span class="eyebrow"><span class="dot"></span>قسم التعليقات</span>
            <h2>اكتب تعليقك وسيظهر الرد الأولي تلقائياً</h2>
          </div>
          <small class="head-sub">يمكنك الوصول لهذا القسم من الزر العلوي مباشرة</small>
        </div>
        <div class="comments-layout">
          <section class="card">
            <form id="commentForm" class="comment-form">
              <label>
                <span>الاسم</span>
                <input type="text" name="name" placeholder="اسمك" required />
              </label>
              <label>
                <span>وسيلة التواصل</span>
                <input type="text" name="contact" placeholder="واتساب أو تيليجرام" />
              </label>
              <label class="full">
                <span>التعليق</span>
                <textarea name="message" placeholder="اكتب تعليقك أو طلبك هنا" required></textarea>
              </label>
              <div class="form-actions full">
                <button class="btn btn-primary" type="submit">إرسال التعليق</button>
                <p id="formStatus" class="form-status"></p>
              </div>
            </form>
          </section>
          <section class="card">
            <div id="commentsFeed" class="comments-feed empty-state">جاري تحميل التعليقات...</div>
          </section>
        </div>
      </section>
    </main>

    <footer class="shell site-footer">
      <p>
        جميع الحقوق محفوظة للمشروع الأصلي — <strong id="rightsTitle">Fares Bot</strong>
        · <a id="rightsChannel" href="#" target="_blank" rel="noreferrer">قناة التحديثات</a>
        · <a id="rightsDeveloper" href="#" target="_blank" rel="noreferrer">واتساب المطور</a>
      </p>
    </footer>

    <script src="/app.js"></script>
  </body>
</html>
'''

deploy_page = '''<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>صفحة ربط الرقم | Fares Bot</title>
    <meta name="description" content="صفحة ربط الرقم الصحيحة في Fares Bot. اطلب كود الاقتران وسيتم نسخه تلقائياً عند إنشائه." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="aurora-bg">
      <div class="aurora aurora-1"></div>
      <div class="aurora aurora-2"></div>
      <div class="aurora aurora-3"></div>
      <div class="aurora aurora-4"></div>
    </div>
    <div class="bg-grid"></div>
    <div class="bg-dots"></div>

    <section class="shell welcome-marquee-shell">
      <div class="welcome-marquee">
        <div class="welcome-track">
          <span>صفحة ربط الرقم ✦ كود صحيح ✦ نسخ تلقائي ✦ صفحة ربط الرقم ✦ كود صحيح ✦ نسخ تلقائي</span>
          <span>صفحة ربط الرقم ✦ كود صحيح ✦ نسخ تلقائي ✦ صفحة ربط الرقم ✦ كود صحيح ✦ نسخ تلقائي</span>
        </div>
      </div>
    </section>

    <header class="topbar shell">
      <div class="brand">
        <div class="brand-avatar-wrap">
          <div class="brand-glow"></div>
          <img class="brand-avatar" src="/hero-image.jpg" alt="Fares Bot" />
        </div>
        <div class="brand-text">
          <strong data-site-title>Fares Bot</strong>
          <p>هذه هي صفحة ربط الرقم الفعلية — ولن تعيدك للرئيسية.</p>
        </div>
      </div>
      <nav class="top-actions">
        <a class="btn btn-soft" href="/bot"><span class="btn-icon">🏠</span><span>العودة لموقع البوت</span></a>
        <a id="navPanel" class="btn btn-secondary" href="/panel"><span class="btn-icon">🏛️</span><span>بوابة الرقم</span></a>
      </nav>
    </header>

    <main class="shell layout layout-tight">
      <section class="card landing-hero">
        <div class="landing-grid deploy-only-grid">
          <div class="landing-copy">
            <span class="eyebrow"><span class="dot"></span>صفحة ربط الرقم</span>
            <h1><span class="gradient-text">اطلب كود الاقتران</span> من نفس الصفحة</h1>
            <p>تم إصلاح المشكلة: الآن لما تضغط «فتح صفحة الرقم» ستبقى داخل صفحة الربط الصحيحة، تدخل الرقم، تضغط طلب كود، ويظهر لك الكود الصحيح ويتم نسخه تلقائياً مباشرة.</p>
            <div class="whatsapp-showcase">
              <article class="wa-card wa-official"><div class="wa-icon">🕒</div><div><strong id="siteClock">00:00:00</strong><p id="siteClockDate">جاري تحميل الوقت...</p></div></article>
              <article class="wa-card wa-business"><div class="wa-icon">✅</div><div><strong id="serviceLiveBadge">الخدمة فعّالة</strong><p>استخراج الكود والنسخ التلقائي جاهز.</p></div></article>
              <article class="wa-card wa-classic"><div class="wa-icon">📊</div><div><strong id="totalPairingCodesIssued">0</strong><p>إجمالي أكواد الاقتران الصادرة</p></div></article>
            </div>
          </div>

          <aside class="pairing-showcase" id="pairingSection">
            <div class="pairing-badge">PAIR PAGE · AUTO COPY</div>
            <h2>صفحة الرقم</h2>
            <p>أدخل الرقم الدولي، فعّل التأكيد، ثم اضغط طلب كود الاقتران.</p>
            <form id="publicPairForm" class="public-pair-form" autocomplete="off">
              <label class="full">
                <span>رقم واتساب</span>
                <input id="publicPairNumber" name="number" type="text" inputmode="numeric" placeholder="مثال: 96777XXXXXXX" required />
              </label>
              <label class="pair-terms full">
                <input id="publicPairAccepted" name="accepted" type="checkbox" />
                <span>أؤكد أن الرقم ثانوي ومخصص للربط فقط</span>
              </label>
              <div class="form-actions full">
                <button class="btn btn-primary" type="submit"><span class="btn-icon">🔗</span><span>طلب كود الاقتران</span></button>
                <p id="publicPairStatus" class="form-status"></p>
              </div>
            </form>
            <div id="publicPairResult" class="pair-result hidden">
              <div class="pair-code-line">
                <span>كود الاقتران</span>
                <code id="publicPairCode">—</code>
              </div>
              <div class="pair-copy-row">
                <button id="copyPairCodeBtn" class="btn btn-soft" type="button">📋 نسخ الكود الخام</button>
                <p id="pairCodeHint" class="hint-line">عند نجاح الإنشاء سيتم نسخ الكود الخام تلقائياً.</p>
              </div>
              <ol class="pair-steps">
                <li>افتح واتساب ثم الأجهزة المرتبطة</li>
                <li>اختر ربط جهاز عبر رقم</li>
                <li>الصق الكود المنسوخ تلقائياً</li>
                <li>بعد الربط افتح لوحة الرقم لإدارة الإعدادات</li>
              </ol>
              <a id="publicPairPanelLink" class="btn btn-soft" href="/panel">فتح لوحة هذا الرقم</a>
            </div>
          </aside>
        </div>
      </section>
    </main>

    <footer class="shell site-footer">
      <p>
        جميع الحقوق محفوظة للمشروع الأصلي — <strong id="rightsTitle">Fares Bot</strong>
        · <a id="rightsChannel" href="#" target="_blank" rel="noreferrer">قناة التحديثات</a>
        · <a id="rightsDeveloper" href="#" target="_blank" rel="noreferrer">واتساب المطور</a>
      </p>
    </footer>

    <script src="/app.js"></script>
  </body>
</html>
'''

app_js = r'''const state = { config: null, stats: null, rawPairCode: '', pairCountdownTimer: null, themeIndex: 0 };

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
'''

styles_append = '''

/* ===== bot vertical refresh 2026 ===== */
.bot-vertical-single {
  grid-template-columns: 1fr;
  max-width: 1040px;
  margin: 0 auto;
}
.bot-stats-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.bot-mini-stats-grid {
  margin-top: 18px;
}
.deploy-only-grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(360px, 0.9fr);
}
.comment-form input,
.comment-form textarea,
.public-pair-form input {
  color: #fff;
}
@media (max-width: 1100px) {
  .bot-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .bot-stats-grid, .bot-mini-stats-grid, .deploy-only-grid { grid-template-columns: 1fr; }
}
'''

(public / 'index.html').write_text(shared_page.format(title='Fares Bot | موقع البوت'))
(public / 'bot.html').write_text(shared_page.format(title='Fares Bot | موقع البوت'))
(public / 'deploy.html').write_text(deploy_page)
(public / 'app.js').write_text(app_js)

styles_path = public / 'styles.css'
styles = styles_path.read_text()
if '/* ===== bot vertical refresh 2026 ===== */' not in styles:
    styles += styles_append
styles_path.write_text(styles)

panel_path = public / 'panel.js'
panel = panel_path.read_text()
old = """      const rawCode = String((data && data.rawCode) || '').replace(/[^A-Za-z0-9]/g, '')\n      safeSet('panelPairCode', data.code || rawCode || '—')\n      const box = qs('panelPairCodeBox'); if (box) box.classList.remove('hidden')\n      setStatus(status, '✅ تم إصدار الكود بنجاح. أدخله في واتساب بدون شرطات أو مسافات إضافية.', 'success')\n"""
new = """      const rawCode = String((data && data.rawCode) || '').replace(/[^A-Za-z0-9]/g, '')\n      safeSet('panelPairCode', data.code || rawCode || '—')\n      const box = qs('panelPairCodeBox'); if (box) box.classList.remove('hidden')\n      let copied = false\n      try {\n        await navigator.clipboard.writeText(rawCode)\n        copied = true\n      } catch {}\n      setStatus(status, copied\n        ? '✅ تم إصدار الكود ونسخه تلقائياً. ألصقه الآن في واتساب بدون شرطات أو مسافات إضافية.'\n        : '✅ تم إصدار الكود بنجاح. أدخله في واتساب بدون شرطات أو مسافات إضافية.', 'success')\n"""
if old in panel:
    panel = panel.replace(old, new)
panel_path.write_text(panel)

web_path = root / 'web.js'
web = web_path.read_text()
old_cfg = """        aiChatEnabled: config.AI_CHAT_ENABLED,\n        aiPageUrl: `${config.WEBSITE_URL.replace(/\\/+$/, '')}/ai`,\n        sitePairingEnabled: true,\n"""
new_cfg = """        aiChatEnabled: config.AI_CHAT_ENABLED,\n        aiPageUrl: `${config.WEBSITE_URL.replace(/\\/+$/, '')}/ai`,\n        sitePairingEnabled: true,\n        databaseInfo: {\n          mongoEnabled: db.isMongoEnabled(),\n          sessionStorageMode: config.SESSION_STORAGE_MODE,\n          automaticIndexes: true,\n          sessionPersistence: true,\n          autoReconnect: true,\n          statusAutomation: true,\n          writeLocalStateCache: config.WRITE_LOCAL_STATE_CACHE === true,\n        },\n"""
if old_cfg in web:
    web = web.replace(old_cfg, new_cfg)
web_path.write_text(web)

print('site refresh applied')
