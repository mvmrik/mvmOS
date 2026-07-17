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

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
  var FONT_SCALE = { sm: '90%', md: '100%', lg: '112%', xl: '125%' };

  function applyTheme(theme, fontSize) {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    if (fontSize) localStorage.setItem(FONT_KEY, fontSize);
    theme = theme || localStorage.getItem(THEME_KEY) || 'dark';
    fontSize = fontSize || localStorage.getItem(FONT_KEY) || 'md';

    var vars = THEMES[theme] || THEMES.dark;
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
      '.mvm-user{display:flex;align-items:center;gap:8px;font-family:system-ui,sans-serif;flex-shrink:0}' +
      '.mvm-user-name{display:flex;flex-direction:column;line-height:1.2}' +
      '.mvm-user-lbl{font-size:11px;color:var(--fg2,#a6adc8)}' +
      '.mvm-user-val{font-size:13px;font-weight:700;color:var(--accent,#89b4fa);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mvm-logout{border:1px solid var(--border,#45475a);border-radius:8px;padding:5px 12px;font-size:.82rem;' +
      'background:var(--surface2,#313244);color:var(--fg,#cdd6f4);cursor:pointer;font-family:inherit}' +
      '.mvm-logout:hover{background:var(--border,#45475a)}' +
      '.mvm-ftr{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;' +
      'border-top:1px solid var(--border,#45475a);background:var(--surface1,#181825);' +
      'font-family:system-ui,sans-serif;font-size:.72rem;color:var(--fg2,#a6adc8);flex-shrink:0;order:999}' +
      '.mvm-ftr a{color:inherit;text-decoration:none}' +
      '.mvm-ftr a:hover{color:var(--accent,#89b4fa)}';
    document.head.appendChild(s);
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
    var root = findRoot();
    if (root) root.style.cssText += ';flex:1 1 auto;min-height:0;overflow:auto';
  }

  function buildHeader(appMeta, user) {
    var hdr = document.createElement('header');
    hdr.className = 'mvm-hdr';

    var crumbs = document.createElement('div');
    crumbs.className = 'mvm-crumbs';
    var homeIsCurrent = !APP_ID || APP_ID === 'apphub';
    if (homeIsCurrent) {
      crumbs.innerHTML = '<span class="mvm-cur">🧩 Home</span>';
    } else {
      var label = appMeta ? (esc(appMeta.icon || '') + ' ' + esc(appMeta.name || APP_ID)) : esc(APP_ID);
      crumbs.innerHTML = '<a href="/pub/apphub/">🧩 Home</a><span class="mvm-sep">/</span><span class="mvm-cur">' + label + '</span>';
    }
    hdr.appendChild(crumbs);

    var spacer = document.createElement('div');
    spacer.style.flex = '1';
    hdr.appendChild(spacer);

    if (user) {
      var box = document.createElement('div');
      box.className = 'mvm-user';
      box.innerHTML = renderAvatar(user, 26)
        + '<div class="mvm-user-name"><span class="mvm-user-lbl">Logged in as</span><span class="mvm-user-val">' + esc(user.display_name) + '</span></div>'
        + '<button class="mvm-logout" type="button">Logout</button>';
      box.querySelector('.mvm-logout').onclick = async function () {
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

  async function refresh() {
    var existingHdr = document.querySelector('.mvm-hdr');
    var placeholderHdr = existingHdr || buildHeader(null, null);
    if (!existingHdr) document.body.prepend(placeholderHdr);

    var results = await Promise.all([fetchAppMeta(), fetchUser()]);
    var finalHdr = buildHeader(results[0], results[1]);
    placeholderHdr.replaceWith(finalHdr);

    var user = results[1];
    if (user) applyTheme(user.theme, user.font_size);
  }

  async function init() {
    if (document.querySelector('.mvm-hdr')) return; // already mounted
    ensureStyle();
    reflow();
    document.body.appendChild(buildFooter());
    await refresh();
  }

  window.MvmLayout = { refresh: refresh, applyTheme: applyTheme, THEMES: THEMES, FONT_SCALE: FONT_SCALE };

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
