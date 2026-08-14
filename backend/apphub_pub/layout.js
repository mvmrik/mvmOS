/* Shared header/footer chrome for every /pub/<app>/ page.
 * Auto-injected server-side (see backend/main.py) — no app ever includes
 * this manually. Breadcrumb left (Home -> current app), identity + logout
 * right, thin footer. Reads the same apphub_token every app already uses. */
(function () {
  var THIS_SCRIPT = document.currentScript;
  var APP_ID = (THIS_SCRIPT && THIS_SCRIPT.getAttribute('data-mvm-app')) || '';
  var TOKEN_KEY = 'apphub_token';
  var THEME_KEY = 'apphub_theme';
  var FONT_KEY  = 'apphub_font_size';
  var LANG_KEY  = 'apphub_language';
  // A received mvmShare link is for an unknown recipient. It must render in
  // the browser language, not in an Apps Hub profile or this origin's saved
  // public-page preference.
  var BROWSER_LANGUAGE_ONLY = !!(window.mvmOS && window.mvmOS.browserLanguageOnly);

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  // This file is injected into every /pub/<app>/ page, including ones that
  // never load /i18n/i18n.js themselves, so window.t can't be relied on to
  // exist. Use it opportunistically (it works on apphub's own page and any
  // app that does load i18n) and fall back to plain English otherwise —
  // same keys as frontend/i18n/en.js so translations stay in sync when
  // window.t is present.
  function tt(key, fallback) {
    try {
      if (window.t) {
        var s = window.t(key);
        if (s && s !== key) return s;
      }
    } catch (e) {}
    return fallback;
  }

  // ── Appearance (theme + text size) ───────────────────────────────
  // Ready-made color pairs only — no free color pickers — so a user can't
  // land on an unreadable combination. Applied by overriding CSS custom
  // properties every public page already styles with. Two naming sets:
  //   --bg/--fg/... (unprefixed)   — standalone public pages with their own
  //                                  :root (apphub itself, gamehub, ...).
  //   --pub-bg/--pub-fg/... (prefixed) — the shared budget/chat/calendar
  //                                  widgets, which this same JS also mounts
  //                                  inside desktop windows (frontend/style.css
  //                                  already owns unprefixed --bg/--border/
  //                                  --accent there for the desktop shell) —
  //                                  a prefixed, unclaimed namespace keeps the
  //                                  public-theme override from ever leaking
  //                                  into the desktop UI.
  // Kept in sync with backend/apphub.py VALID_THEMES.
  var THEMES = {
    dark: null, // default palette already baked into each page's own CSS
    light: {
      '--bg': '#f6f8fa', '--surface1': '#ffffff', '--surface2': '#eaeef2',
      '--border': '#d0d7de', '--fg': '#1f2328', '--fg2': '#656d76',
      '--accent': '#0969da', '--green': '#1a7f37', '--red': '#cf222e', '--yellow': '#9a6700',

      '--pub-bg': '#f6f8fa', '--pub-surface1': '#ffffff', '--pub-surface2': '#eaeef2',
      '--pub-border': '#d0d7de', '--pub-fg': '#1f2328', '--pub-fg2': '#656d76',
      '--pub-dim': '#8c959f', '--pub-crust': '#eef1f4',
      '--pub-accent': '#0969da', '--pub-accent-hover': '#0860ca',
      '--pub-green': '#1a7f37', '--pub-red': '#cf222e', '--pub-yellow': '#9a6700', '--pub-warning': '#9a6700'
    }
  };
  var FONT_SCALE = { sm: '90%', md: '100%', lg: '112%', xl: '125%', xxl: '140%', xxxl: '155%' };

  // ── Language ──────────────────────────────────────────────────────
  // 'auto' resolution mirrors backend/main.py's pre-paint bootstrap (which
  // already set window.mvmOS.pubLang before /i18n/i18n.js ran): match
  // navigator.language against whatever core actually ships. Kept in JS
  // here too so a language change from the Settings tab takes effect
  // without a full page reload — the bootstrap script only runs on the
  // next navigation.
  function resolvedLanguage(lang, available) {
    if (lang && lang !== 'auto') return lang;
    var nav = (navigator.language || 'en').toLowerCase();
    for (var i = 0; i < available.length; i++) {
      if (nav.indexOf(available[i]) === 0) return available[i];
    }
    return 'en';
  }

  function applyLanguage(lang) {
    if (BROWSER_LANGUAGE_ONLY) {
      lang = 'auto';
    } else {
      if (!lang) return;
      localStorage.setItem(LANG_KEY, lang);
    }
    var available = (window.mvmOS && window.mvmOS.availableLangs) || ['en'];
    var resolved = resolvedLanguage(lang, available);
    // /i18n/i18n.js owns the loader whenever the page includes it. Going through
    // it keeps a single loader in charge of window._i18n — two racing over a
    // wholesale assignment is what used to leave app strings rendering as raw
    // keys — and it already knows which language is in flight, so a repeat of
    // the one being loaded costs nothing. The loader below is only for public
    // pages that don't include i18n.js at all, where tt() still needs a table.
    if (window.mvmOS && window.mvmOS.setLang) { window.mvmOS.setLang(resolved); return; }
    if (window.mvmOS && window.mvmOS.lang === resolved) return;
    if (document.querySelector('script[data-i18n-lang="' + resolved + '"]')) return;
    var script = document.createElement('script');
    var stamps = (window.mvmOS && window.mvmOS.langStamps) || null;
    var v = stamps && stamps[resolved] != null ? stamps[resolved] : Date.now();
    script.src = '/i18n/' + resolved + '.js?v=' + v;
    script.dataset.i18nLang = resolved;
    script.onload = function () {
      document.querySelectorAll('script[data-i18n-lang]').forEach(function (s) {
        if (s !== script) s.remove();
      });
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.dataset.i18n;
        if (window._i18n && window._i18n[key]) el.textContent = window._i18n[key];
      });
      document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
        var key = el.dataset.i18nPh;
        if (window._i18n && window._i18n[key]) el.placeholder = window._i18n[key];
      });
      // The window-level 'i18n-loaded' listener registered below rebuilds
      // the header off this same event, so it isn't called again here.
      window.dispatchEvent(new CustomEvent('i18n-loaded', { detail: resolved }));
    };
    document.head.appendChild(script);
  }

  function resolvedTheme(theme) {
    if (theme !== 'auto') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme, fontSize) {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    if (fontSize) localStorage.setItem(FONT_KEY, fontSize);
    theme = theme || localStorage.getItem(THEME_KEY) || 'dark';
    fontSize = fontSize || localStorage.getItem(FONT_KEY) || 'md';

    // main.py's pre-paint bootstrap puts the last-known light palette and
    // font size directly on <html> to prevent a flash on reload. Inline
    // properties outrank this stylesheet, so clear only those bootstrap
    // values before applying a new live preference; otherwise light → dark
    // (and text-size changes) appears stuck until the page is reloaded.
    var root = document.documentElement;
    root.style.removeProperty('font-size');
    Object.keys(THEMES.light).forEach(function (key) { root.style.removeProperty(key); });

    var vars = THEMES[resolvedTheme(theme)] || THEMES.dark;
    var css = 'html{font-size:' + (FONT_SCALE[fontSize] || FONT_SCALE.md) + '}';
    if (vars) {
      var decls = Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';');
      css += ':root{' + decls + '}';
    }
    var s = document.getElementById('mvm-theme-vars');
    if (!s) {
      s = document.createElement('style');
      s.id = 'mvm-theme-vars';
      document.head.appendChild(s);
    }
    s.textContent = css;
  }

  // Keep public pages in sync when the OS/browser changes appearance while
  // the page is already open. Explicit light/dark choices remain untouched.
  if (window.matchMedia) {
    var systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemThemeChange = function () {
      if (localStorage.getItem(THEME_KEY) === 'auto') applyTheme('auto');
    };
    if (systemTheme.addEventListener) systemTheme.addEventListener('change', onSystemThemeChange);
    else if (systemTheme.addListener) systemTheme.addListener(onSystemThemeChange);
  }

  // Apply the last-known prefs immediately (before any network round-trip)
  // so there's no flash of the wrong theme/size on load.
  applyTheme();

  function renderAvatar(user, size) {
    user = user || {};
    if (user.avatar_svg) {
      return user.avatar_svg.replace(/width="\d+"/, 'width="' + size + '"').replace(/height="\d+"/, 'height="' + size + '"');
    }
    var letter = esc(((user.display_name || '?')[0] || '?').toUpperCase());
    var color = esc(user.avatar_color || '#585b70');
    return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" style="border-radius:50%;display:block;flex-shrink:0" xmlns="http://www.w3.org/2000/svg">'
      + '<circle cx="50" cy="50" r="50" fill="' + color + '"/>'
      + '<text x="50" y="67" font-family="system-ui,sans-serif" font-size="54" font-weight="700" fill="#1e1e2e" text-anchor="middle">' + letter + '</text></svg>';
  }

  // ── Notifications bell ────────────────────────────────────────────
  // Apps Hub's own inbox, in the public header next to the profile and the
  // credits pill. An app addresses an Apps Hub profile through
  // backend/notifications.py::notify(); this is where that profile reads it,
  // and for the many people who have an Apps Hub account but no mvmOS
  // desktop login at all, it is the only place it could ever appear.
  var _notifs = [];
  var _bellOpen = false;
  var _appI18n = {};

  function pubHeaders() {
    var token = localStorage.getItem(TOKEN_KEY);
    return token ? { 'X-Pub-Token': token } : {};
  }

  // An app's own strings are never in the core language file — they ship
  // inside the app's own zip — so a notification that arrived as a
  // translation key stays unreadable until that app's table is on the page.
  // Pull one in for every app that actually sent such a notification. An app
  // without an i18n.js simply 404s and the stored sentence keeps showing.
  function ensureAppI18n(rows) {
    var wanted = {};
    rows.forEach(function (n) {
      if ((n.title_key || n.body_key) && n.action_app) wanted[n.action_app] = 1;
    });
    Object.keys(wanted).forEach(function (id) {
      if (_appI18n[id]) return;
      _appI18n[id] = true;
      var s = document.createElement('script');
      s.src = '/apps/' + encodeURIComponent(id) + '/i18n.js';
      s.onload = function () { renderBell(); };
      s.onerror = function () {};
      document.head.appendChild(s);
    });
  }

  // A notification carries its text twice over. `title`/`body` are finished
  // sentences, which is the only sane form for genuinely free text. But the
  // reader is a different person from the sender, may well be using another
  // language, and reads it days later — so an app that knows what its
  // notification says sends a translation key and its variables instead, and
  // it is resolved here, at the moment it is rendered, in whatever language
  // the reader is on. The sentence stays as the fallback.
  function notifText(n) {
    var vars = {};
    if (n.vars) { try { vars = JSON.parse(n.vars) || {}; } catch (e) {} }
    function one(key, fallback) {
      var table = window._i18n || {};
      if (!key || !table[key]) return fallback || '';
      return String(table[key]).replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? vars[k] : '';
      });
    }
    return { title: one(n.title_key, n.title), body: one(n.body_key, n.body) };
  }

  function notifTime(iso) {
    try {
      var d = new Date(iso);
      var lang = (window.mvmOS && window.mvmOS.lang) || undefined;
      if (d.toDateString() === new Date().toDateString()) {
        return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    } catch (e) { return ''; }
  }

  function renderNotifRow(n) {
    var text = notifText(n);
    return '<button class="mvm-notif-item' + (n.is_read ? '' : ' mvm-notif-unread') + '" type="button" data-id="' + esc(n.id) + '">'
      + '<span class="mvm-notif-dot"></span>'
      + '<span class="mvm-notif-text">'
        + '<span class="mvm-notif-title">' + esc(text.title) + '</span>'
        + (text.body ? '<span class="mvm-notif-body">' + esc(text.body) + '</span>' : '')
        + '<span class="mvm-notif-time">' + esc(notifTime(n.created_at)) + '</span>'
      + '</span></button>';
  }

  function buildBell() {
    var wrap = document.createElement('div');
    wrap.className = 'mvm-bell';
    // No bell at all until there is something behind it: an empty one is
    // just noise in a header that also has to fit on a phone.
    if (!_notifs.length) return wrap;

    var unread = 0;
    _notifs.forEach(function (n) { if (!n.is_read) unread++; });
    var label = esc(tt('notif_title', 'Notifications'));

    wrap.innerHTML =
      '<button class="mvm-bell-btn" type="button" aria-haspopup="true" aria-expanded="' + (_bellOpen ? 'true' : 'false') + '" title="' + label + '" aria-label="' + label + '">'
        + '<span class="mvm-bell-icon' + (unread ? '' : ' mvm-bell-idle') + '">🔔</span>'
        + (unread ? '<span class="mvm-bell-count">' + esc(unread > 99 ? '99+' : unread) + '</span>' : '')
      + '</button>'
      + '<div class="mvm-notif"' + (_bellOpen ? '' : ' hidden') + '>'
        + '<div class="mvm-notif-hdr"><span>' + label + '</span>'
          + (unread ? '<button class="mvm-notif-all" type="button">' + esc(tt('notif_mark_all_read', 'Mark all read')) + '</button>' : '')
        + '</div>'
        + '<div class="mvm-notif-list">' + _notifs.slice(0, 30).map(renderNotifRow).join('') + '</div>'
      + '</div>';

    var btn = wrap.querySelector('.mvm-bell-btn');
    var panel = wrap.querySelector('.mvm-notif');
    btn.onclick = function (e) {
      e.stopPropagation();
      var menu = document.querySelector('.mvm-menu');
      if (menu) menu.hidden = true;
      _bellOpen = !_bellOpen;
      panel.hidden = !_bellOpen;
      btn.setAttribute('aria-expanded', String(_bellOpen));
    };

    var allBtn = wrap.querySelector('.mvm-notif-all');
    if (allBtn) {
      allBtn.onclick = function (e) {
        e.stopPropagation();
        _notifs.forEach(function (n) { n.is_read = 1; });
        renderBell();
        fetch('/api/notifications/read-all', { method: 'POST', headers: pubHeaders() }).catch(function () {});
      };
    }

    wrap.querySelectorAll('.mvm-notif-item').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var id = Number(el.dataset.id), found = null;
        _notifs.forEach(function (n) { if (n.id === id) found = n; });
        if (!found) return;
        if (!found.is_read) {
          found.is_read = 1;
          renderBell();
          fetch('/api/notifications/' + id + '/read', { method: 'POST', headers: pubHeaders() }).catch(function () {});
        }
        // `link` is how a notification points at what it is about out here.
        // action_app is a desktop instruction — "open this app in a window" —
        // and there is no desktop on a public page to carry it out.
        if (found.link) location.href = found.link;
      };
    });
    return wrap;
  }

  // The bell re-renders on its own rather than through renderHeader(), which
  // rebuilds the whole header element and would close the open panel out from
  // under whoever is reading it.
  function renderBell() {
    var existing = document.querySelector('.mvm-bell');
    if (existing) existing.replaceWith(buildBell());
  }

  async function refreshNotifications() {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    var rows = [];
    try {
      var r = await fetch('/api/notifications', { headers: pubHeaders() });
      if (!r.ok) return;
      rows = await r.json();
    } catch (e) { return; }
    if (!Array.isArray(rows)) return;
    _notifs = rows;
    ensureAppI18n(rows);
    renderBell();
  }

  function ensureStyle() {
    if (document.getElementById('mvm-layout-css')) return;
    var s = document.createElement('style');
    s.id = 'mvm-layout-css';
    s.textContent =
      '.mvm-hdr{display:flex;align-items:center;gap:12px;padding:9px 16px;border-bottom:1px solid var(--border,#45475a);' +
      'background:var(--surface1,#181825);font-family:system-ui,sans-serif;flex-shrink:0;order:-1}' +
      '.mvm-crumbs{display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;color:var(--fg,#cdd6f4);min-width:0}' +
      '.mvm-crumbs a{color:inherit;text-decoration:none}' +
      '.mvm-crumbs a:hover{color:var(--accent,#89b4fa)}' +
      '.mvm-crumbs .mvm-sep{color:var(--fg2,#a6adc8);font-weight:400}' +
      '.mvm-crumbs .mvm-cur{color:var(--fg2,#a6adc8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mvm-user{position:relative;display:flex;align-items:center;font-family:system-ui,sans-serif;flex-shrink:0}' +
      '.mvm-avatar-btn{display:flex;align-items:center;gap:6px;background:none;border:none;padding:3px;border-radius:999px;cursor:pointer}' +
      '.mvm-avatar-btn:hover{background:var(--surface2,#313244)}' +
      '.mvm-credits-pill{display:flex;align-items:center;gap:2px;font-size:11px;font-weight:700;line-height:1;' +
      'color:var(--fg,#cdd6f4);background:var(--surface2,#313244);border:1px solid var(--border,#45475a);' +
      'border-radius:999px;padding:4px 8px;white-space:nowrap}' +
      '.mvm-bell{position:relative;display:flex;align-items:center;flex-shrink:0;font-family:system-ui,sans-serif}' +
      '.mvm-bell-btn{position:relative;display:flex;align-items:center;background:none;border:none;padding:5px;' +
      'border-radius:999px;cursor:pointer;font-size:16px;line-height:1}' +
      '.mvm-bell-btn:hover{background:var(--surface2,#313244)}' +
      '.mvm-bell-idle{filter:grayscale(1) opacity(.5)}' +
      '.mvm-bell-count{position:absolute;top:-1px;right:-3px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;' +
      'border-radius:999px;background:var(--red,#f38ba8);color:#1e1e2e;font-size:10px;font-weight:700;line-height:16px;text-align:center}' +
      '.mvm-notif{position:absolute;top:calc(100% + 8px);right:0;width:min(320px,calc(100vw - 24px));' +
      'background:var(--surface1,#181825);border:1px solid var(--border,#45475a);border-radius:10px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:1001;display:flex;flex-direction:column;overflow:hidden}' +
      '.mvm-notif[hidden]{display:none}' +
      '.mvm-notif-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;' +
      'border-bottom:1px solid var(--border,#45475a);font-size:12px;font-weight:700;color:var(--fg,#cdd6f4)}' +
      '.mvm-notif-all{background:none;border:none;padding:0;font-family:inherit;font-size:11px;font-weight:600;' +
      'color:var(--accent,#89b4fa);cursor:pointer;white-space:nowrap}' +
      '.mvm-notif-list{max-height:min(60vh,380px);overflow-y:auto;display:flex;flex-direction:column}' +
      '.mvm-notif-item{display:flex;align-items:flex-start;gap:8px;width:100%;padding:9px 11px;background:none;' +
      'border:none;border-bottom:1px solid var(--border,#45475a);text-align:left;font-family:inherit;cursor:pointer}' +
      '.mvm-notif-item:last-child{border-bottom:none}' +
      '.mvm-notif-item:hover{background:var(--surface2,#313244)}' +
      '.mvm-notif-dot{width:7px;height:7px;border-radius:50%;background:transparent;margin-top:5px;flex-shrink:0}' +
      '.mvm-notif-unread .mvm-notif-dot{background:var(--accent,#89b4fa)}' +
      '.mvm-notif-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}' +
      '.mvm-notif-title{font-size:12.5px;font-weight:600;color:var(--fg,#cdd6f4);word-break:break-word}' +
      '.mvm-notif-body{font-size:11.5px;color:var(--fg2,#a6adc8);word-break:break-word}' +
      '.mvm-notif-time{font-size:10.5px;color:var(--fg2,#a6adc8);opacity:.8}' +
      /* On a phone the public-app root clips absolute descendants. The bell
       * therefore opens as a viewport panel, not as a child of the narrow
       * header container. */
      '@media(max-width:600px){.mvm-notif{position:fixed;top:72px;right:12px;left:12px;width:auto;max-width:none;max-height:calc(100dvh - 84px)}.mvm-notif-list{max-height:calc(100dvh - 132px)}}' +
      '.mvm-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:200px;background:var(--surface1,#181825);' +
      'border:1px solid var(--border,#45475a);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);' +
      'z-index:1000;display:flex;flex-direction:column;padding:6px}' +
      '.mvm-menu[hidden]{display:none}' +
      '.mvm-menu-hdr{display:flex;align-items:center;gap:9px;padding:8px 8px 10px}' +
      '.mvm-menu-name{font-size:13px;font-weight:700;color:var(--fg,#cdd6f4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mvm-menu-item{display:flex;align-items:center;gap:9px;padding:9px 8px;border-radius:7px;font-size:13px;' +
      'color:var(--fg,#cdd6f4);text-decoration:none;background:none;border:none;text-align:left;width:100%;' +
      'font-family:inherit;cursor:pointer}' +
      '.mvm-menu-item:hover{background:var(--surface2,#313244)}' +
      '.mvm-menu-logout{color:var(--red,#f38ba8);border-top:1px solid var(--border,#45475a);margin-top:4px;padding-top:11px}' +
      '.mvm-ftr{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;' +
      'border-top:1px solid var(--border,#45475a);background:var(--surface1,#181825);' +
      'font-family:system-ui,sans-serif;font-size:.72rem;color:var(--fg2,#a6adc8);flex-shrink:0;order:999}' +
      '.mvm-ftr a{color:inherit;text-decoration:none}' +
      '.mvm-ftr a:hover{color:var(--accent,#89b4fa)}' +
      // Small private pages traditionally put icon, title and explanation as
      // direct body children.  The chrome makes body a column, so without this
      // wrapper its first icon div gets mistaken for the app root and expands
      // to fill the page, leaving the text at the bottom.
      '.mvm-public-private{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;box-sizing:border-box}';
    document.head.appendChild(s);
  }

  function wrapPrivatePage() {
    var visual = [];
    var kids = Array.prototype.slice.call(document.body.children);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === 'DIV' && (el.classList.contains('icon') || el.classList.contains('msg') || el.classList.contains('sub'))) visual.push(el);
    }
    // Only the deliberately tiny private-page shape is wrapped. Full public
    // applications keep their own DOM structure and root exactly as before.
    if (!visual.length || !visual.some(function (el) { return el.classList.contains('msg'); })) return;
    var wrap = document.createElement('div');
    wrap.className = 'mvm-public-private';
    document.body.insertBefore(wrap, visual[0]);
    visual.forEach(function (el) { wrap.appendChild(el); });
  }

  function findRoot() {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'DIV') return kids[i];
    }
    return null;
  }

  function reflow() {
    document.body.style.cssText += ';display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;height:100dvh;width:100%;margin:0;overflow:hidden;box-sizing:border-box';
    wrapPrivatePage();
    var root = findRoot();
    if (root) root.style.cssText += ';flex:1 1 auto;min-height:0;overflow:auto';
  }

  // Just the avatar is always visible (name + logout used to sit right in the
  // header, which is too cramped on phones); everything else — name, credit
  // balance, profile/settings links, logout — moves into a dropdown opened by
  // tapping the avatar. The credit balance also gets a small pill next to the
  // avatar itself, so it's visible without opening the menu.
  function buildHeader(appMeta, user, credits) {
    var hdr = document.createElement('header');
    hdr.className = 'mvm-hdr';

    var crumbs = document.createElement('div');
    crumbs.className = 'mvm-crumbs';
    var homeIsCurrent = !APP_ID || APP_ID === 'apphub';
    var homeLabel = '🧩 ' + esc(tt('ah_pub_home', 'Home'));
    if (homeIsCurrent) {
      crumbs.innerHTML = '<span class="mvm-cur">' + homeLabel + '</span>';
    } else {
      var label = appMeta ? (esc(appMeta.icon || '') + ' ' + esc(appMeta.name || APP_ID)) : esc(APP_ID);
      crumbs.innerHTML = '<a href="/pub/apphub/">' + homeLabel + '</a><span class="mvm-sep">/</span><span class="mvm-cur">' + label + '</span>';
    }
    hdr.appendChild(crumbs);

    var spacer = document.createElement('div');
    spacer.style.flex = '1';
    hdr.appendChild(spacer);

    if (user) {
      hdr.appendChild(buildBell());

      var creditsUnit = tt('ah_pub_credits_unit', 'credits');
      var creditsText = credits != null ? (credits + ' ' + creditsUnit) : creditsUnit;
      // Credits are a premium feature of the installation. Where it has no
      // licence they are left out altogether — no pill, no menu item, no lock
      // and no mention of premium. Nobody reading a public page can activate
      // anything on this machine, so a hint would only be noise.
      var hasCredits = !!(user && user.credits);

      var box = document.createElement('div');
      box.className = 'mvm-user';
      box.innerHTML =
        '<button class="mvm-avatar-btn" type="button" aria-haspopup="true" aria-expanded="false">'
          + renderAvatar(user, 28)
          + (hasCredits && credits ? '<span class="mvm-credits-pill">🪙 ' + esc(credits) + '</span>' : '')
        + '</button>'
        + '<div class="mvm-menu" hidden>'
          + '<div class="mvm-menu-hdr">' + renderAvatar(user, 32) + '<span class="mvm-menu-name">' + esc(user.display_name) + '</span></div>'
          + (hasCredits ? '<a class="mvm-menu-item" href="/pub/apphub/?tab=credits" data-tab="credits">🪙 ' + esc(creditsText) + '</a>' : '')
          + '<a class="mvm-menu-item" href="/pub/apphub/?tab=profile" data-tab="profile">👤 ' + esc(tt('ah_pub_tab_profile', 'Profile')) + '</a>'
          + '<a class="mvm-menu-item" href="/pub/apphub/?tab=settings" data-tab="settings">⚙️ ' + esc(tt('ah_pub_tab_settings', 'Settings')) + '</a>'
          + '<button class="mvm-menu-item mvm-menu-logout" type="button">↪ ' + esc(tt('ah_logout', 'Logout')) + '</button>'
        + '</div>';

      var menuBtn = box.querySelector('.mvm-avatar-btn');
      var menu = box.querySelector('.mvm-menu');
      menuBtn.onclick = function (e) {
        e.stopPropagation();
        if (_bellOpen) { _bellOpen = false; renderBell(); }
        var willOpen = menu.hidden;
        menu.hidden = !willOpen;
        menuBtn.setAttribute('aria-expanded', String(willOpen));
      };

      // On apphub's own page, switch tabs in place through its SPA router
      // (window.MvmApphub, exposed by index.html) instead of a full reload —
      // real navigation only makes sense when coming from a different app,
      // and window.MvmApphub simply won't exist there, so the <a href> below
      // falls through to a normal page load in that case.
      box.querySelectorAll('.mvm-menu-item[data-tab]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (!(window.MvmApphub && window.MvmApphub.goToTab)) return;
          e.preventDefault();
          menu.hidden = true;
          window.MvmApphub.goToTab(el.dataset.tab);
        });
      });

      box.querySelector('.mvm-menu-logout').onclick = async function () {
        var token = localStorage.getItem(TOKEN_KEY);
        try {
          await fetch('/api/pub/apphub/logout', { method: 'POST', headers: { 'X-Pub-Token': token || '' } });
        } catch (e) {}
        localStorage.clear();
        location.href = '/pub/apphub/';
      };
      hdr.appendChild(box);
    }
    return hdr;
  }

  // Registered once at script load (not per header rebuild, since refresh()
  // replaces the header element every time) — closes the menu on outside
  // click or Escape, whichever header instance is currently in the DOM.
  document.addEventListener('click', function (e) {
    var menu = document.querySelector('.mvm-menu');
    var box = document.querySelector('.mvm-user');
    if (menu && !menu.hidden && box && !box.contains(e.target)) {
      menu.hidden = true;
      var btn = box.querySelector('.mvm-avatar-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    var bell = document.querySelector('.mvm-bell');
    if (_bellOpen && bell && !bell.contains(e.target)) { _bellOpen = false; renderBell(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var menu = document.querySelector('.mvm-menu');
    if (menu) menu.hidden = true;
    if (_bellOpen) { _bellOpen = false; renderBell(); }
  });

  function buildFooter() {
    var ftr = document.createElement('footer');
    ftr.className = 'mvm-ftr';
    ftr.innerHTML = '<span>mvmOS</span><span>·</span><a href="https://github.com/mvmrik/mvmOS" target="_blank" rel="noopener">GitHub</a>';
    return ftr;
  }

  async function fetchUser() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      var r = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': token } });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function fetchCredits() {
    var token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      var r = await fetch('/api/pub/apphub/credits', { headers: { 'X-Pub-Token': token } });
      if (!r.ok) return null;
      var d = await r.json();
      return typeof d.balance === 'number' ? d.balance : null;
    } catch (e) { return null; }
  }

  async function fetchAppMeta() {
    if (!APP_ID || APP_ID === 'apphub') return null;
    try {
      var r = await fetch('/api/pub/apphub/apps');
      if (!r.ok) return null;
      var apps = await r.json();
      for (var i = 0; i < apps.length; i++) if (apps[i].id === APP_ID) return apps[i];
    } catch (e) {}
    return null;
  }

  // What refresh() last fetched, so a rebuild caused purely by a language change
  // re-renders the header from it instead of repeating the three requests.
  var _lastResults = null;

  function renderHeader() {
    var r = _lastResults || [null, null, null];
    var hdr = buildHeader(r[0], r[1], r[2]);
    var existingHdr = document.querySelector('.mvm-hdr');
    if (existingHdr) existingHdr.replaceWith(hdr);
    else document.body.prepend(hdr);
    return hdr;
  }

  async function refresh() {
    renderHeader();   // placeholder, or the previous header while this reloads

    var base = await Promise.all([fetchAppMeta(), fetchUser()]);
    // The balance is only worth asking for where the installation has the
    // feature at all — /me says so, and without it the endpoint does not exist.
    var credits = base[1] && base[1].credits ? await fetchCredits() : null;
    _lastResults = [base[0], base[1], credits];
    renderHeader();

    var user = _lastResults[1];
    if (user) {
      applyTheme(user.theme, user.font_size);
      applyLanguage(user.language);
      refreshNotifications();
    }
  }

  async function init() {
    if (document.querySelector('.mvm-hdr')) return; // already mounted
    ensureStyle();
    reflow();
    document.body.appendChild(buildFooter());
    await refresh();
    // A public page is often left open for a long time on a phone, so the
    // bell has to notice something arriving without a reload. One request a
    // minute, and only while the tab is actually being looked at — a
    // backgrounded tab polling forever is what drains a phone battery.
    setInterval(function () {
      if (!document.hidden) refreshNotifications();
    }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshNotifications();
    });
  }

  window.MvmLayout = {
    refresh: refresh, applyTheme: applyTheme, applyLanguage: applyLanguage,
    // Apps that create a notification themselves (or act on one) can pull the
    // bell up to date instead of waiting for the next poll.
    refreshNotifications: refreshNotifications,
    THEMES: THEMES, FONT_SCALE: FONT_SCALE
  };

  // The header is often built (via refresh() above) before /i18n/i18n.js has
  // finished loading the actual language file, so that first buildHeader()
  // call renders with tt()'s hardcoded fallback text. i18n.js fires
  // 'i18n-loaded' once window.t is actually ready; rebuild the header then so
  // "Home" etc. pick up the real translation without needing a language
  // switch to trigger it. This re-renders from the cached fetch rather than
  // calling refresh(), which would repeat /me and /credits on every page load.
  window.addEventListener('i18n-loaded', function () {
    if (document.querySelector('.mvm-hdr')) renderHeader();
  });

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
