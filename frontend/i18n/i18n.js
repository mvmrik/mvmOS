// mvmOS i18n loader
(function () {
  function _getLang() {
    try {
      const s = JSON.parse(localStorage.getItem('mvmos_settings') || '{}');
      return s.language || 'en';
    } catch (_) { return 'en'; }
  }

  function _load(lang) {
    const script = document.createElement('script');
    script.src = `/i18n/${lang}.js`;
    script.onerror = () => {
      if (lang !== 'en') _load('en'); // fallback
    };
    script.onload = () => {
      // update static DOM elements with data-i18n attribute
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (window._i18n && window._i18n[key]) el.textContent = window._i18n[key];
      });
      // update placeholders
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.dataset.i18nPh;
        if (window._i18n && window._i18n[key]) el.placeholder = window._i18n[key];
      });
      window.dispatchEvent(new CustomEvent('i18n-loaded', { detail: lang }));
    };
    document.head.appendChild(script);
  }

  window.t = function (key, vars) {
    const str = (window._i18n && window._i18n[key]) || key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  };

  // expose for apps
  if (!window.mvmOS) window.mvmOS = {};
  window.mvmOS.t = window.t;

  _load(_getLang());

  // reload on language change
  window.addEventListener('settings-changed', e => {
    const lang = e.detail?.language || 'en';
    const current = document.querySelector('script[src^="/i18n/"]');
    if (current && current.src.includes(`/${lang}.js`)) return;
    _load(lang);
  });
})();
