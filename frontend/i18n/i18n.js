// mvmOS i18n loader
(function () {
  function _load(lang) {
    // remove previously loaded language scripts
    document.querySelectorAll('script[data-i18n-lang]').forEach(s => s.remove());
    const script = document.createElement('script');
    script.src = `/i18n/${lang}.js?v=${Date.now()}`;
    script.dataset.i18nLang = lang;
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
  window.mvmOS.lang = 'en';

  // apps can register a callback to be notified on language change
  const _langListeners = [];
  window.mvmOS.onLangChange = function(cb) { _langListeners.push(cb); };

  // promise that resolves after first language load
  let _resolveReady;
  window.mvmOS.i18nReady = new Promise(res => { _resolveReady = res; });
  window.addEventListener('i18n-loaded', e => {
    window.mvmOS.lang = e.detail;
    _resolveReady();
    _langListeners.forEach(cb => cb(e.detail));
  }, { once: true });

  // subsequent reloads (language change after first load)
  window.addEventListener('i18n-loaded', e => {
    if (window.mvmOS.lang === e.detail) return;
    window.mvmOS.lang = e.detail;
    _langListeners.forEach(cb => cb(e.detail));
  });

  fetch('/api/settings')
    .then(r => r.json())
    .then(s => _load(s.language || 'en'))
    .catch(() => _load('en'));

  // reload on language change
  window.addEventListener('settings-changed', e => {
    const lang = e.detail?.language || 'en';
    const current = document.querySelector('script[data-i18n-lang]');
    if (current && current.dataset.i18nLang === lang) return;
    _load(lang);
  });
})();
