(function () {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const hashMap = {
    '#deploy': '/bot/deploy',
    '#settings': '/bot/settings',
    '#autosave': '/bot/autosave',
    '#autoreply': '/bot/autoreply',
    '#about': '/bot/about',
    '#faq': '/bot/faq',
    '#contact': '/bot/contact',
  };

  if ((path === '/bot' || path === '/bot.html') && hashMap[window.location.hash]) {
    window.location.replace(hashMap[window.location.hash]);
    return;
  }

  const pageKey = (() => {
    if (path === '/bot' || path === '/bot.html') return 'home';
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'home';
  })();

  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.getAttribute('data-nav') === pageKey) link.classList.add('is-active');
  });

  async function loadConfig() {
    try {
      const res = await fetch('/api/public/config');
      const data = await res.json();
      if (!data.ok || !data.config) return;

      const cfg = data.config;
      const map = {
        channel: cfg.whatsappChannelUrl || '#',
        developer: cfg.developerWhatsappUrl || '#',
        panel: cfg.ownerPanelUrl || '/panel',
        home: cfg.websiteUrl || '/',
        ai: cfg.aiPageUrl || '/ai',
        telegram: cfg.telegramBotUrl || '#',
      };

      document.querySelectorAll('[data-link]').forEach((el) => {
        const key = el.getAttribute('data-link');
        if (map[key]) el.href = map[key];
      });

      document.querySelectorAll('[data-site-title]').forEach((el) => {
        el.textContent = cfg.siteTitle || 'Fares Bot';
      });

      document.querySelectorAll('[data-developer-number]').forEach((el) => {
        el.textContent = cfg.developerWhatsappNumber || 'غير متوفر';
      });
    } catch (err) {
      console.error(err);
    }
  }

  loadConfig();
  let hue = 0; setInterval(() => { hue = (hue + 38) % 360; document.documentElement.style.setProperty('--mini-hue', hue + 'deg'); }, 1000);
})();
