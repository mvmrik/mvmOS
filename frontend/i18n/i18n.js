// mvmOS i18n loader
(function () {
  // The language most recently asked for. Two loads can overlap: a public page
  // requests the browser/localStorage language up front and then the account's
  // own language once /api/pub/apphub/me answers. A language file assigns
  // window._i18n wholesale, so whichever request is no longer the wanted one
  // must not announce itself as the current language.
  let _requested = null;

  function _announce(lang) {
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
  }

  function _load(lang) {
    _requested = lang;
    // remove previously loaded language scripts
    document.querySelectorAll('script[data-i18n-lang]').forEach(s => s.remove());
    const script = document.createElement('script');
    // A stable per-file stamp when the page has one (public pages get it from
    // the head bootstrap), so the browser can actually cache ~80 KB of table
    // instead of re-fetching it on every single page load.
    const stamps = (window.mvmOS && window.mvmOS.langStamps) || null;
    const v = stamps && stamps[lang] != null ? stamps[lang] : Date.now();
    script.src = `/i18n/${lang}.js?v=${v}`;
    script.dataset.i18nLang = lang;
    script.onerror = () => {
      if (lang !== 'en') _load('en'); // fallback
    };
    script.onload = () => {
      if (_requested !== lang) return;   // a newer language was asked for meanwhile
      _announce(lang);
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
  // Start from the language this loader is actually about to fetch (pubLang is
  // set by the bootstrap in backend/main.py before this file runs), not a blanket
  // 'en'. A caller that compares against mvmOS.lang to decide whether it needs to
  // switch — apphub_pub/layout.js does — would otherwise read 'en' while Bulgarian
  // is loading and skip a switch to English that it should have made.
  window.mvmOS.lang = window.mvmOS.pubLang || 'en';

  // The one entry point for changing language. apphub_pub/layout.js hand-rolled
  // its own loader for this, which put two of them in a race over the same
  // wholesale window._i18n assignment; it now delegates here whenever this file
  // is on the page.
  window.mvmOS.setLang = function (lang) {
    if (!lang || lang === _requested) return;
    _load(lang);
  };

  // apps can register a callback to be notified on language change
  const _langListeners = [];
  window.mvmOS.onLangChange = function(cb) { _langListeners.push(cb); };

  // promise that resolves after first language load
  let _resolveReady;
  window.mvmOS.i18nReady = new Promise(res => { _resolveReady = res; });

  // A language file assigns window._i18n wholesale, so loading one *erases*
  // the tables store apps merged into it (§11), and these listeners are the
  // only thing that puts them back. They therefore have to fire on every load,
  // including a repeat load of the language that is already active — which is
  // exactly what a public page does: this loader requests the language, and
  // apphub_pub/layout.js requests it again once /api/pub/apphub/me reports the
  // viewer's preference. Skipping the notify on that second load left every
  // app string rendering as its raw key.
  window.addEventListener('i18n-loaded', e => {
    window.mvmOS.lang = e.detail;
    _resolveReady();
    _langListeners.forEach(cb => cb(e.detail));
  });

  // Public pages have no OS session, so /api/settings 401s there and this
  // loader would otherwise always fall back to English (see the .catch
  // below). backend/main.py injects a bootstrap into <head> that sets
  // window.mvmOS.pubLang before this script runs — resolved from the
  // last-known preference in localStorage, or navigator.language when there
  // is none. The account's own setting then overrides it through
  // layout.js::applyLanguage() as soon as /api/pub/apphub/me answers, so a
  // public page never has to touch the desktop-only endpoint at all.
  if (window.mvmOS.pubLang && window._i18n) {
    // The bootstrap already pulled the table in synchronously, so there is
    // nothing to fetch — adopt it rather than downloading the same file again.
    // The announce waits for the rest of the document, since this script sits
    // in <body> and any [data-i18n] markup below it does not exist yet.
    _requested = window.mvmOS.pubLang;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded',
        () => _announce(window.mvmOS.pubLang), { once: true });
    } else {
      _announce(window.mvmOS.pubLang);
    }
  } else if (window.mvmOS.pubLang) {
    _load(window.mvmOS.pubLang);
  } else {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => _load(s.language || 'en'))
      .catch(() => _load('en'));
  }

  // reload on language change
  window.addEventListener('settings-changed', e => {
    const lang = e.detail?.language || 'en';
    const current = document.querySelector('script[data-i18n-lang]');
    if (current && current.dataset.i18nLang === lang) return;
    _load(lang);
  });
})();
