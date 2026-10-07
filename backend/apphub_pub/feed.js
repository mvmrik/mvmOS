/* Community — writing and reading the posts Apps Hub profiles share.
 *
 * One file for both places a post can start: Apps Hub's Community tab, which
 * mounts the whole feed, and the header of any public app page (layout.js),
 * which opens only the composer, filled with suggestions taken from what the
 * person just did there. Nothing in here knows any app: a suggestion is just
 * a word or a value, and an app is just an id with a name and an icon.
 */
(function () {
  if (window.MvmFeed) return;

  var API = '/api/pub/apphub/feed';
  var TOKEN_KEY = 'apphub_token';
  var EMOJI = ('😀 😂 🥲 😊 😍 🥰 😎 🤩 🤔 😴 😅 😭 😡 🥳 😇 🙃 😉 🤗 🙌 👏 👍 👎 💪 🙏 🤝 👋 ✌️ 👌 ' +
    '❤️ 🧡 💛 💚 💙 💜 🖤 💔 ✨ 🔥 ⭐ 🌟 🎉 🎊 🎁 🏆 🥇 🎯 ✅ ❌ ⚡ 💡 📌 📷 🎵 🎮 ⚽ 🏃 🚴 🧘 ' +
    '💧 ☕ 🍵 🍺 🍷 🍕 🍔 🥗 🍎 🍰 🌞 🌙 🌧️ ❄️ 🌈 🌸 🌳 🐶 🐱 🚗 ✈️ 🏠 💼 📚 💰 ⏰ 📅').split(' ');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // window.t where the page has it; the language table itself otherwise (a
  // public app page always has the core table, not always the loader).
  function T(key, fallback, vars) {
    var s = null;
    try { if (window.t) { s = window.t(key); if (s === key) s = null; } } catch (e) {}
    if (!s && window._i18n && window._i18n[key]) s = window._i18n[key];
    s = String(s || fallback || key);
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : ''; }) : s;
  }

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function headers(extra) {
    var h = { 'X-Pub-Token': token() };
    for (var k in extra || {}) h[k] = extra[k];
    return h;
  }

  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers(opts.json ? { 'Content-Type': 'application/json' } : {}),
      body: opts.json ? JSON.stringify(opts.json) : opts.body,
    });
    if (!r.ok) {
      var detail = '';
      try { detail = (await r.json()).detail || ''; } catch (e) {}
      throw new Error(typeof detail === 'string' && detail.indexOf('feed_') === 0 ? T(detail, detail) : T('feed_err_generic', 'Something went wrong. Try again.'));
    }
    return r.json();
  }

  function lang() { return (window.mvmOS && (window.mvmOS.lang || window.mvmOS.pubLang)) || undefined; }

  function ago(iso) {
    var d = new Date(iso), secs = Math.round((Date.now() - d) / 1000);
    try {
      var rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
      if (secs < 60) return rtf.format(0, 'second');
      if (secs < 3600) return rtf.format(-Math.floor(secs / 60), 'minute');
      if (secs < 86400) return rtf.format(-Math.floor(secs / 3600), 'hour');
      if (secs < 7 * 86400) return rtf.format(-Math.floor(secs / 86400), 'day');
      return d.toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    } catch (e) { return d.toLocaleString(); }
  }

  function avatar(u, size) {
    u = u || {};
    if (u.avatar_svg) {
      return '<span class="mvf-av" style="width:' + size + 'px;height:' + size + 'px">' + u.avatar_svg + '</span>';
    }
    var letter = esc(((u.display_name || u.username || '?')[0] || '?').toUpperCase());
    return '<span class="mvf-av mvf-av-l" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.48) + 'px;background:' + esc(u.avatar_color || '#585b70') + '">' + letter + '</span>';
  }

  // ── Apps, by id, for the small "from <app>" line under a post ────────
  var _apps = null;
  function loadApps() {
    if (_apps) return _apps;
    _apps = Promise.all([
      fetch('/api/pub/apphub/apps', { headers: headers() }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch('/api/pub/apphub/branding').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ]).then(function (res) {
      var map = {}, names = (res[1] && res[1].names) || {};
      (res[0] || []).forEach(function (a) {
        map[a.id] = {
          icon: a.icon || '📦', url: a.public_url,
          name: names[a.id] || (window.mvmOS && window.mvmOS.appName ? window.mvmOS.appName(a) : a.name) || a.id,
        };
      });
      return map;
    });
    return _apps;
  }

  // ── Text: escaped, links clickable, the first YouTube address playable ──
  var URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

  function youtubeId(url) {
    var m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
    return m ? m[1] : null;
  }

  function richText(text) {
    var out = '', last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      out += esc(text.slice(last, m.index));
      out += '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(m[0].length > 60 ? m[0].slice(0, 57) + '…' : m[0]) + '</a>';
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out.replace(/\n/g, '<br>');
  }

  function embedFor(text) {
    var urls = String(text || '').match(URL_RE) || [];
    for (var i = 0; i < urls.length; i++) {
      var id = youtubeId(urls[i]);
      if (id) {
        return '<div class="mvf-embed"><iframe src="https://www.youtube-nocookie.com/embed/' + id +
          '" title="YouTube" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
      }
    }
    return '';
  }

  // Photos are behind the same sign-in as the posts, so they are fetched with
  // the token and shown from memory rather than linked directly.
  var _blobs = {};
  function loadImage(img) {
    var name = img.getAttribute('data-media');
    if (_blobs[name]) { img.src = _blobs[name]; return; }
    fetch(API + '/media/' + encodeURIComponent(name), { headers: headers() })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { if (b) { _blobs[name] = URL.createObjectURL(b); img.src = _blobs[name]; } })
      .catch(function () {});
  }

  function lightbox(src) {
    var box = document.createElement('div');
    box.className = 'mvf-light';
    box.innerHTML = '<img alt="">';
    box.querySelector('img').src = src;
    box.onclick = function () { box.remove(); };
    document.body.appendChild(box);
  }

  // ── Styles ───────────────────────────────────────────────────────────
  function ensureStyle() {
    if (document.getElementById('mvf-css')) return;
    var s = document.createElement('style');
    s.id = 'mvf-css';
    s.textContent = [
      '.mvf-root{display:flex;flex-direction:column;gap:14px;max-width:640px;margin:0 auto;width:100%;font-family:system-ui,sans-serif;color:var(--fg,#cdd6f4)}',
      '.mvf-card{background:var(--surface1,#181825);border:1px solid var(--border,#45475a);border-radius:14px;padding:14px;box-sizing:border-box}',
      '.mvf-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;flex-shrink:0;color:#1e1e2e;font-weight:700}',
      '.mvf-av svg{width:100%;height:100%;display:block}',
      '.mvf-start{display:flex;align-items:center;gap:10px;cursor:pointer}',
      '.mvf-start-box{flex:1;padding:11px 14px;border-radius:999px;background:var(--surface2,#313244);color:var(--fg2,#a6adc8);font-size:.95rem}',
      '.mvf-post-hdr{display:flex;align-items:center;gap:10px}',
      '.mvf-who{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.mvf-name{font-weight:700;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mvf-meta{font-size:.78rem;color:var(--fg2,#a6adc8);display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.mvf-meta a{color:inherit;text-decoration:none}.mvf-meta a:hover{color:var(--accent,#89b4fa)}',
      '.mvf-del{background:none;border:none;color:var(--fg2,#a6adc8);cursor:pointer;font-size:1rem;padding:4px 6px;border-radius:8px}',
      '.mvf-del:hover{background:var(--surface2,#313244);color:var(--red,#f38ba8)}',
      '.mvf-text{margin-top:10px;font-size:.98rem;line-height:1.5;word-break:break-word}',
      '.mvf-text a{color:var(--accent,#89b4fa)}',
      '.mvf-embed{margin-top:10px;position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#000}',
      '.mvf-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}',
      '.mvf-media{margin-top:10px;display:grid;gap:4px;border-radius:10px;overflow:hidden}',
      '.mvf-media.n1{grid-template-columns:1fr}.mvf-media.n2,.mvf-media.n4{grid-template-columns:1fr 1fr}.mvf-media.n3{grid-template-columns:1fr 1fr 1fr}',
      '.mvf-media img{width:100%;height:100%;max-height:420px;object-fit:cover;display:block;background:var(--surface2,#313244);cursor:zoom-in;min-height:120px}',
      '.mvf-media.n1 img{object-fit:contain;max-height:520px}',
      '.mvf-quote{margin-top:10px;border:1px solid var(--border,#45475a);border-radius:12px;padding:12px}',
      '.mvf-missing{margin-top:10px;padding:12px;border-radius:12px;background:var(--surface2,#313244);color:var(--fg2,#a6adc8);font-size:.85rem}',
      '.mvf-acts{display:flex;gap:4px;margin-top:10px;border-top:1px solid var(--border,#45475a);padding-top:8px}',
      '.mvf-act{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:none;border:none;color:var(--fg2,#a6adc8);' +
        'font:inherit;font-size:.88rem;padding:8px;border-radius:9px;cursor:pointer}',
      '.mvf-act:hover:not(:disabled){background:var(--surface2,#313244);color:var(--fg,#cdd6f4)}',
      '.mvf-act:disabled{opacity:.35;cursor:default}',
      '.mvf-act.on{color:var(--red,#f38ba8)}',
      '.mvf-comments{margin-top:8px;display:flex;flex-direction:column;gap:8px}',
      '.mvf-cm{display:flex;gap:8px;align-items:flex-start}',
      '.mvf-cm-body{background:var(--surface2,#313244);border-radius:12px;padding:7px 11px;min-width:0;flex:1}',
      '.mvf-cm-name{font-weight:700;font-size:.82rem}',
      '.mvf-cm-text{font-size:.9rem;word-break:break-word;line-height:1.4}',
      '.mvf-cm-time{font-size:.72rem;color:var(--fg2,#a6adc8);margin-top:2px;display:flex;gap:8px}',
      '.mvf-cm-time button{background:none;border:none;padding:0;color:inherit;font:inherit;cursor:pointer}',
      '.mvf-cm-time button:hover{color:var(--red,#f38ba8)}',
      '.mvf-cm-form{display:flex;gap:8px;align-items:center}',
      '.mvf-inp{flex:1;min-width:0;padding:9px 12px;border-radius:999px;border:1px solid var(--border,#45475a);background:var(--surface2,#313244);' +
        'color:var(--fg,#cdd6f4);font:inherit;font-size:.92rem;outline:none;box-sizing:border-box}',
      '.mvf-inp:focus{border-color:var(--accent,#89b4fa)}',
      '.mvf-btn{padding:9px 16px;border-radius:999px;border:none;background:var(--accent,#89b4fa);color:#1e1e2e;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer}',
      '.mvf-btn:disabled{opacity:.5;cursor:default}',
      '.mvf-btn-ghost{background:var(--surface2,#313244);color:var(--fg,#cdd6f4)}',
      '.mvf-empty{text-align:center;color:var(--fg2,#a6adc8);padding:40px 16px;font-size:.95rem;line-height:1.5}',
      '.mvf-more{align-self:center}',
      '.mvf-new{position:sticky;top:8px;z-index:5;align-self:center;box-shadow:0 4px 14px rgba(0,0,0,.3)}',
      '.mvf-light{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out}',
      '.mvf-light img{max-width:96vw;max-height:94vh;object-fit:contain}',
      /* Composer */
      '.mvf-modal{position:fixed;inset:0;z-index:2500;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;' +
        'padding:6vh 12px 12px;box-sizing:border-box;overflow-y:auto;font-family:system-ui,sans-serif}',
      '.mvf-sheet{width:100%;max-width:560px;background:var(--surface1,#181825);color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);' +
        'border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);display:flex;flex-direction:column}',
      '.mvf-sheet-hdr{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border,#45475a);font-weight:700}',
      '.mvf-sheet-hdr span{flex:1}',
      '.mvf-x{background:none;border:none;color:var(--fg2,#a6adc8);font-size:1.3rem;cursor:pointer;line-height:1;padding:2px 6px;border-radius:8px}',
      '.mvf-x:hover{background:var(--surface2,#313244)}',
      '.mvf-sheet-body{padding:14px;display:flex;flex-direction:column;gap:12px}',
      '.mvf-from{display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--fg2,#a6adc8)}',
      '.mvf-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.mvf-chip{padding:6px 11px;border-radius:999px;border:1px solid var(--border,#45475a);background:var(--surface2,#313244);color:var(--fg,#cdd6f4);' +
        'font:inherit;font-size:.85rem;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mvf-chip:hover{border-color:var(--accent,#89b4fa);color:var(--accent,#89b4fa)}',
      '.mvf-chip-k{font-size:.72rem;color:var(--fg2,#a6adc8);margin-right:6px}',
      '.mvf-hint{font-size:.78rem;color:var(--fg2,#a6adc8)}',
      '.mvf-tpls{display:flex;flex-wrap:wrap;gap:6px}',
      '.mvf-tpl{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--accent,#89b4fa);overflow:hidden}',
      '.mvf-tpl button{border:none;background:transparent;color:var(--accent,#89b4fa);font:inherit;font-size:.85rem;cursor:pointer;padding:6px 4px 6px 11px}',
      '.mvf-tpl button+button{padding:6px 10px 6px 6px;color:var(--fg2,#a6adc8)}',
      '.mvf-tpl button+button:hover{color:var(--red,#f38ba8)}',
      '.mvf-tpl-save{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.mvf-link{border:none;background:none;padding:0;color:var(--accent,#89b4fa);font:inherit;font-size:.82rem;cursor:pointer}',
      '.mvf-tpl-form{display:flex;gap:6px;flex:1;min-width:220px}',
      '.mvf-ta{width:100%;min-height:110px;max-height:50vh;resize:vertical;padding:10px 12px;border-radius:12px;border:1px solid var(--border,#45475a);' +
        'background:var(--surface2,#313244);color:var(--fg,#cdd6f4);font:inherit;font-size:1rem;line-height:1.45;outline:none;box-sizing:border-box}',
      '.mvf-ta:focus{border-color:var(--accent,#89b4fa)}',
      '.mvf-thumbs{display:flex;flex-wrap:wrap;gap:8px}',
      '.mvf-thumb{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;background:var(--surface2,#313244)}',
      '.mvf-thumb img{width:100%;height:100%;object-fit:cover}',
      '.mvf-thumb button{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:.8rem;line-height:22px;padding:0}',
      '.mvf-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.mvf-tool{background:var(--surface2,#313244);border:1px solid var(--border,#45475a);color:var(--fg,#cdd6f4);border-radius:10px;padding:7px 10px;font:inherit;font-size:1.05rem;cursor:pointer;line-height:1}',
      '.mvf-tool:hover{border-color:var(--accent,#89b4fa)}',
      '.mvf-sel{background:var(--surface2,#313244);border:1px solid var(--border,#45475a);color:var(--fg,#cdd6f4);border-radius:10px;padding:7px 8px;font:inherit;font-size:.88rem;max-width:100%}',
      '.mvf-tools .mvf-btn{margin-left:auto}',
      '.mvf-emoji{display:grid;grid-template-columns:repeat(auto-fill,minmax(36px,1fr));gap:2px;max-height:180px;overflow-y:auto;padding:6px;border-radius:12px;background:var(--surface2,#313244)}',
      '.mvf-emoji[hidden]{display:none}',
      '.mvf-emoji button{background:none;border:none;font-size:1.35rem;padding:4px;border-radius:8px;cursor:pointer;line-height:1.2}',
      '.mvf-emoji button:hover{background:var(--surface1,#181825)}',
      '.mvf-people{display:flex;flex-direction:column;gap:8px}',
      '.mvf-people[hidden]{display:none}',
      '.mvf-picked{display:flex;flex-wrap:wrap;gap:6px}',
      '.mvf-pick{display:flex;align-items:center;gap:6px;padding:3px 4px 3px 3px;border-radius:999px;background:var(--surface2,#313244);font-size:.85rem}',
      '.mvf-pick button{background:none;border:none;color:var(--fg2,#a6adc8);cursor:pointer;padding:0 6px;font-size:.9rem}',
      '.mvf-found{display:flex;flex-direction:column;gap:2px;max-height:180px;overflow-y:auto}',
      '.mvf-found button{display:flex;align-items:center;gap:8px;background:none;border:none;color:var(--fg,#cdd6f4);font:inherit;font-size:.9rem;text-align:left;padding:6px;border-radius:9px;cursor:pointer}',
      '.mvf-found button:hover{background:var(--surface2,#313244)}',
      '.mvf-err{color:var(--red,#f38ba8);font-size:.85rem}',
      '.mvf-err:empty{display:none}',
      '@media(max-width:600px){.mvf-modal{padding:0;align-items:stretch}.mvf-sheet{max-width:none;border-radius:0;min-height:100%}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Composer ─────────────────────────────────────────────────────────
  var AUD_ICON = { all: '🌍', favourites: '⭐', people: '👥' };
  function audLabel(a) {
    return a === 'all' ? T('feed_aud_all', 'Everyone') : a === 'favourites' ? T('feed_aud_favourites', 'Favourites') : T('feed_aud_people', 'Chosen people');
  }

  var _defaultAudience = null;
  function defaultAudience() {
    if (!_defaultAudience) {
      _defaultAudience = api('/settings').then(function (s) { return s.audience; }).catch(function () { return 'favourites'; });
    }
    return _defaultAudience;
  }

  /* opts: {app_id, chips: [text], shared: post, onPosted(post)} */
  // What a suggested value is, told by the field it came from: "amount_ml"
  // says "Amount" beside "500 ml". The field's name is all there is, so it
  // reads as the app's code wrote it; the unit is already on the value.
  var UNIT_WORDS = /^(cents|ml|l|liters?|litres?|kg|mg|g|grams?|kcal|cal|calories|percent|pct|min|mins|minutes|sec|secs|seconds|h|hours|km|cm)$/;
  function fieldLabel(key) {
    var words = String(key || '').replace(/_\d+$/, function (m) { return m === '_100' ? m : ''; }).split('_').filter(Boolean);
    var per = words[words.length - 1] === '100' ? words.pop() : '';
    while (words.length > 1 && UNIT_WORDS.test(words[words.length - 1])) words.pop();
    if (!words.length || (words.length === 1 && words[0] === 'value')) return '';
    var s = words.join(' ') + (per ? ' /100' : '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  async function compose(opts) {
    opts = opts || {};
    ensureStyle();
    var apps = await loadApps();
    var app = opts.app_id ? apps[opts.app_id] : null;
    var images = [];   // File objects
    var people = [];   // profiles
    var aud = await defaultAudience();
    var shared = opts.shared || null;
    // Templates need to know which field each suggested value came from.
    var keys = opts.keys && opts.chips && opts.keys.length === opts.chips.length ? opts.keys : null;
    var canTemplate = !!(opts.app_id && keys && keys.length && !shared);

    var modal = document.createElement('div');
    modal.className = 'mvf-modal';
    modal.innerHTML =
      '<div class="mvf-sheet" role="dialog" aria-modal="true">'
      + '<div class="mvf-sheet-hdr"><span>' + esc(shared ? T('feed_repost_title', 'Share post') : T('feed_new_post', 'New post')) + '</span>'
      + '<button class="mvf-x" type="button" aria-label="' + esc(T('close', 'Close')) + '">×</button></div>'
      + '<div class="mvf-sheet-body">'
      + (app ? '<div class="mvf-from">' + esc(app.icon) + ' ' + esc(T('feed_from_app', 'From {app}', { app: app.name })) + '</div>' : '')
      + (opts.chips && opts.chips.length ? '<div class="mvf-hint">' + esc(T('feed_chips_hint', 'Tap a value to add it to your text')) + '</div><div class="mvf-tpls" hidden></div><div class="mvf-chips"></div>' : '')
      + '<textarea class="mvf-ta" maxlength="5000" placeholder="' + esc(shared ? T('feed_repost_ph', 'Say something about it (optional)') : T('feed_compose_ph', 'What would you like to share?')) + '"></textarea>'
      + (shared ? '<div class="mvf-quote-wrap"></div>' : '<div class="mvf-thumbs"></div>')
      + '<div class="mvf-emoji" hidden></div>'
      + '<div class="mvf-people" hidden><div class="mvf-picked"></div>'
      + '<input class="mvf-inp" type="search" placeholder="' + esc(T('feed_people_ph', 'Search people by name')) + '"><div class="mvf-found"></div></div>'
      + (canTemplate ? '<div class="mvf-tpl-save" hidden><button class="mvf-link" type="button">💾 ' + esc(T('feed_tpl_save', 'Save as template')) + '</button>'
        + '<span class="mvf-tpl-form" hidden><input class="mvf-inp" maxlength="60" placeholder="' + esc(T('feed_tpl_name_ph', 'Template name')) + '">'
        + '<button class="mvf-btn" type="button">' + esc(T('feed_tpl_save_btn', 'Save')) + '</button></span></div>' : '')
      + '<div class="mvf-err"></div>'
      + '<div class="mvf-tools">'
      + (shared ? '' : '<button class="mvf-tool" type="button" data-t="photo" title="' + esc(T('feed_add_photo', 'Add photos')) + '">📷</button>'
        + '<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>')
      + '<button class="mvf-tool" type="button" data-t="emoji" title="' + esc(T('feed_emoji', 'Emoji')) + '">😊</button>'
      + '<select class="mvf-sel" title="' + esc(T('feed_audience', 'Who can see it')) + '">'
      + ['all', 'favourites', 'people'].map(function (a) {
          return '<option value="' + a + '"' + (a === aud ? ' selected' : '') + '>' + AUD_ICON[a] + ' ' + esc(audLabel(a)) + '</option>';
        }).join('')
      + '</select>'
      + '<button class="mvf-btn" type="button" data-t="post">' + esc(T('feed_post_btn', 'Post')) + '</button>'
      + '</div></div></div>';
    document.body.appendChild(modal);

    var ta = modal.querySelector('.mvf-ta');
    var err = modal.querySelector('.mvf-err');
    var sel = modal.querySelector('.mvf-sel');
    var peopleBox = modal.querySelector('.mvf-people');
    var emojiBox = modal.querySelector('.mvf-emoji');
    var postBtn = modal.querySelector('[data-t="post"]');

    function close() { modal.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    modal.querySelector('.mvf-x').onclick = close;
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });

    function insert(text) {
      var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      var end = ta.selectionEnd != null ? ta.selectionEnd : start;
      var before = ta.value.slice(0, start), after = ta.value.slice(end);
      var pad = before && !/\s$/.test(before) ? ' ' : '';
      var tail = after && !/^\s/.test(after) ? ' ' : '';
      ta.value = before + pad + text + tail + after;
      var pos = (before + pad + text + tail).length;
      ta.focus();
      try { ta.setSelectionRange(pos, pos); } catch (e) {}
    }

    var chipsBox = modal.querySelector('.mvf-chips');
    var used = [];   // indexes of the values put into the text
    if (chipsBox) {
      opts.chips.forEach(function (c, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'mvf-chip'; b.title = c;
        var label = keys ? ((opts.labels && opts.labels[i]) || fieldLabel(keys[i])) : '';
        b.innerHTML = (label ? '<span class="mvf-chip-k">' + esc(label) + '</span>' : '') + esc(c);
        b.onclick = function () {
          insert(c);
          if (used.indexOf(i) < 0) used.push(i);
          if (saveRow) saveRow.hidden = false;
        };
        chipsBox.appendChild(b);
      });
    }

    // Templates: the text with {field} where a value was put, filled in again
    // with the values of whatever is being shared this time.
    var tplBox = modal.querySelector('.mvf-tpls');
    var saveRow = modal.querySelector('.mvf-tpl-save');
    function escRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function toTemplate(text) {
      var parts = used.map(function (i) { return { v: opts.chips[i], k: keys[i] }; })
        .sort(function (a, b) { return b.v.length - a.v.length; });
      if (!parts.length) return text;
      var re = new RegExp(parts.map(function (x) { return escRe(x.v); }).join('|'), 'g');
      return text.replace(re, function (m) { return '{' + parts.filter(function (x) { return x.v === m; })[0].k + '}'; });
    }
    function slots(text) {
      var out = [], m, re = /\{([^{}\s]+)\}/g;
      while ((m = re.exec(text))) out.push(m[1]);
      return out;
    }
    function fill(text) {
      return text.replace(/\{([^{}\s]+)\}/g, function (m, k) {
        var i = keys.indexOf(k);
        return i >= 0 ? opts.chips[i] : m;
      });
    }
    function drawTemplates(list) {
      if (!tplBox) return;
      tplBox.innerHTML = '';
      // Only the ones whose every value this action has.
      list.filter(function (tp) { return slots(tp.text).every(function (k) { return keys.indexOf(k) >= 0; }); }).forEach(function (tp) {
        var d = document.createElement('span');
        d.className = 'mvf-tpl';
        d.innerHTML = '<button type="button"></button><button type="button" aria-label="' + esc(T('feed_tpl_delete', 'Delete template')) + '" title="' + esc(T('feed_tpl_delete', 'Delete template')) + '">×</button>';
        var use = d.firstChild, del = d.lastChild;
        use.textContent = '📝 ' + tp.name;
        use.title = fill(tp.text);
        use.onclick = function () { ta.value = fill(tp.text); ta.focus(); };
        del.onclick = async function () {
          if (!confirm(T('feed_tpl_delete_confirm', 'Delete the template "{name}"?', { name: tp.name }))) return;
          try {
            await api('/templates/' + tp.id, { method: 'DELETE' });
            templates = templates.filter(function (x) { return x.id !== tp.id; });
            drawTemplates(templates);
          } catch (e) { err.textContent = e.message; }
        };
        tplBox.appendChild(d);
      });
      tplBox.hidden = !tplBox.children.length;
    }
    var templates = [];
    if (canTemplate) {
      api('/templates?app_id=' + encodeURIComponent(opts.app_id)).then(function (r) {
        templates = r.templates || [];
        drawTemplates(templates);
      }).catch(function () {});
      var tplForm = saveRow.querySelector('.mvf-tpl-form');
      var tplName = tplForm.querySelector('input');
      saveRow.querySelector('.mvf-link').onclick = function () {
        tplForm.hidden = !tplForm.hidden;
        if (!tplForm.hidden) tplName.focus();
      };
      var saveTemplate = async function () {
        err.textContent = '';
        var name = tplName.value.trim(), text = ta.value.trim();
        if (!name || !text) { err.textContent = T('feed_err_template', 'Write a text and a name for the template.'); return; }
        try {
          var tp = await api('/templates', { method: 'POST', json: { app_id: opts.app_id, name: name, text: toTemplate(text) } });
          templates = templates.filter(function (x) { return x.id !== tp.id; }).concat([tp])
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
          drawTemplates(templates);
          tplName.value = '';
          tplForm.hidden = true;
        } catch (e) { err.textContent = e.message; }
      };
      tplForm.querySelector('.mvf-btn').onclick = saveTemplate;
      tplName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveTemplate(); } });
    }

    EMOJI.forEach(function (em) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = em;
      b.onclick = function () { insert(em); };
      emojiBox.appendChild(b);
    });
    modal.querySelector('[data-t="emoji"]').onclick = function () { emojiBox.hidden = !emojiBox.hidden; };

    if (shared) {
      var qw = modal.querySelector('.mvf-quote-wrap');
      qw.appendChild(renderQuote(shared, apps));
    } else {
      var file = modal.querySelector('input[type=file]');
      var thumbs = modal.querySelector('.mvf-thumbs');
      modal.querySelector('[data-t="photo"]').onclick = function () { file.click(); };
      var drawThumbs = function () {
        thumbs.innerHTML = '';
        images.forEach(function (f, i) {
          var d = document.createElement('div');
          d.className = 'mvf-thumb';
          d.innerHTML = '<img alt=""><button type="button" aria-label="×">×</button>';
          d.querySelector('img').src = URL.createObjectURL(f);
          d.querySelector('button').onclick = function () { images.splice(i, 1); drawThumbs(); };
          thumbs.appendChild(d);
        });
      };
      var addFiles = function (files) {
        err.textContent = '';
        Array.prototype.forEach.call(files, function (f) {
          if (images.length >= 4) { err.textContent = T('feed_err_four', 'Up to 4 photos per post.'); return; }
          if (f.size > 10 * 1024 * 1024) { err.textContent = T('feed_err_image_big', 'A photo can be up to 10 MB.'); return; }
          images.push(f);
        });
        drawThumbs();
      };
      file.onchange = function () { addFiles(file.files); file.value = ''; };
      if (opts.images && opts.images.length) addFiles(opts.images);
      // Pasting a picture straight into the text adds it as a photo.
      ta.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.files) || [];
        if (!items.length) return;
        Array.prototype.forEach.call(items, function (f) {
          if (/^image\//.test(f.type) && images.length < 4 && f.size <= 10 * 1024 * 1024) images.push(f);
        });
        drawThumbs();
      });
    }

    // Chosen people
    var picked = modal.querySelector('.mvf-picked');
    var found = modal.querySelector('.mvf-found');
    var search = peopleBox.querySelector('input');
    function drawPicked() {
      picked.innerHTML = '';
      people.forEach(function (p, i) {
        var d = document.createElement('span');
        d.className = 'mvf-pick';
        d.innerHTML = avatar(p, 22) + esc(p.display_name || p.username) + '<button type="button" aria-label="×">×</button>';
        d.querySelector('button').onclick = function () { people.splice(i, 1); drawPicked(); };
        picked.appendChild(d);
      });
    }
    var favs = null;
    async function showFound(list) {
      found.innerHTML = '';
      list.filter(function (u) { return !people.some(function (p) { return p.id === u.id; }); }).slice(0, 20).forEach(function (u) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = avatar(u, 26) + '<span>' + esc(u.display_name || u.username) + ' <span class="mvf-hint">@' + esc(u.username) + '</span></span>';
        b.onclick = function () { people.push(u); drawPicked(); search.value = ''; showFound(favs || []); };
        found.appendChild(b);
      });
    }
    var searchTimer = null;
    search.oninput = function () {
      clearTimeout(searchTimer);
      var q = search.value.trim();
      if (q.length < 2) { showFound(favs || []); return; }
      searchTimer = setTimeout(function () {
        api('/people?q=' + encodeURIComponent(q)).then(showFound).catch(function () {});
      }, 250);
    };
    async function syncAudience() {
      peopleBox.hidden = sel.value !== 'people';
      if (sel.value === 'people' && favs === null) {
        favs = [];
        try {
          var r = await fetch('/api/pub/apphub/favourites', { headers: headers() });
          favs = r.ok ? await r.json() : [];
        } catch (e) {}
        if (!search.value.trim()) showFound(favs);
      }
    }
    sel.onchange = syncAudience;
    syncAudience();

    postBtn.onclick = async function () {
      err.textContent = '';
      var text = ta.value.trim();
      if (!text && !images.length && !shared) { err.textContent = T('feed_err_empty', 'Write something or add a photo.'); return; }
      if (sel.value === 'people' && !people.length) { err.textContent = T('feed_err_no_people', 'Choose at least one person.'); return; }
      var fd = new FormData();
      fd.append('text', text);
      fd.append('audience', sel.value);
      fd.append('people', people.map(function (p) { return p.id; }).join(','));
      if (opts.app_id) fd.append('app_id', opts.app_id);
      if (shared) fd.append('shared_id', String(shared.id));
      images.forEach(function (f) { fd.append('images', f, f.name || 'photo'); });
      postBtn.disabled = true;
      try {
        var post = await api('', { method: 'POST', body: fd });
        close();
        if (opts.onPosted) opts.onPosted(post);
        window.dispatchEvent(new CustomEvent('mvm-feed-posted', { detail: post }));
      } catch (e) {
        err.textContent = e.message;
        postBtn.disabled = false;
      }
    };
    setTimeout(function () { ta.focus(); }, 30);
  }

  // ── A post ───────────────────────────────────────────────────────────
  function postBody(p, apps) {
    var app = p.app_id && apps[p.app_id];
    var media = p.media || [];
    return '<div class="mvf-post-hdr">' + avatar(p.author, 40)
      + '<div class="mvf-who"><span class="mvf-name">' + esc(p.author ? p.author.display_name || p.author.username : T('feed_deleted_user', 'Deleted profile')) + '</span>'
      + '<span class="mvf-meta"><span title="' + esc(new Date(p.created_at).toLocaleString(lang())) + '">' + esc(ago(p.created_at)) + '</span>'
      + '<span title="' + esc(audLabel(p.audience) + (p.people ? ': ' + p.people.map(function (u) { return u.display_name; }).join(', ') : '')) + '">· ' + AUD_ICON[p.audience] + '</span>'
      + (app ? '<span>· <a href="' + esc(app.url || '#') + '">' + esc(app.icon) + ' ' + esc(app.name) + '</a></span>' : '')
      + '</span></div></div>'
      + (p.text ? '<div class="mvf-text">' + richText(p.text) + '</div>' + embedFor(p.text) : '')
      + (media.length ? '<div class="mvf-media n' + media.length + '">' + media.map(function (m) {
          return '<img alt="" data-media="' + esc(m) + '">';
        }).join('') + '</div>' : '');
  }

  function wireMedia(el) {
    el.querySelectorAll('img[data-media]').forEach(function (img) {
      loadImage(img);
      img.onclick = function () { if (img.src) lightbox(img.src); };
    });
  }

  function renderQuote(p, apps) {
    var q = document.createElement('div');
    q.className = 'mvf-quote';
    q.innerHTML = postBody(p, apps);
    wireMedia(q);
    return q;
  }

  function renderPost(p, apps, ctx) {
    var el = document.createElement('article');
    el.className = 'mvf-card mvf-post';
    el.dataset.id = p.id;
    // What a repost passes on is always the original.
    var target = p.shared || (p.audience === 'all' && !p.shared_missing ? p : null);
    el.innerHTML = postBody(p, apps)
      + '<div class="mvf-q"></div>'
      + '<div class="mvf-acts">'
      + '<button class="mvf-act' + (p.liked ? ' on' : '') + '" data-a="like" type="button">' + (p.liked ? '❤️' : '🤍') + ' <span>' + (p.likes || '') + '</span> ' + esc(T('feed_like', 'Like')) + '</button>'
      + '<button class="mvf-act" data-a="comment" type="button">💬 <span>' + (p.comments || '') + '</span> ' + esc(T('feed_comment', 'Comment')) + '</button>'
      + '<button class="mvf-act" data-a="share" type="button"' + (target ? '' : ' disabled title="' + esc(T('feed_share_only_public', 'Only posts for everyone can be shared')) + '"') + '>🔁 <span>' + (p.shares || '') + '</span> ' + esc(T('feed_share', 'Share')) + '</button>'
      + '</div><div class="mvf-comments" hidden></div>';
    // The post's own photos first, before the quoted original brings its own.
    wireMedia(el);
    var qbox = el.querySelector('.mvf-q');
    if (p.shared) qbox.appendChild(renderQuote(p.shared, apps));
    else if (p.shared_missing) qbox.innerHTML = '<div class="mvf-missing">' + esc(T('feed_original_gone', 'The original post is no longer available.')) + '</div>';

    if (p.can_delete) {
      var del = document.createElement('button');
      del.className = 'mvf-del'; del.type = 'button'; del.textContent = '🗑';
      del.title = T('feed_delete', 'Delete');
      el.querySelector('.mvf-post-hdr').appendChild(del);
    }
    if (del) del.onclick = async function () {
      if (!confirm(T('feed_delete_confirm', 'Delete this post?'))) return;
      try { await api('/post/' + p.id, { method: 'DELETE' }); el.remove(); } catch (e) { alert(e.message); }
    };

    var like = el.querySelector('[data-a="like"]');
    like.onclick = async function () {
      like.disabled = true;
      try {
        var r = await api('/post/' + p.id + '/like', { method: 'POST' });
        p.liked = r.liked; p.likes = r.likes;
        like.classList.toggle('on', r.liked);
        like.innerHTML = (r.liked ? '❤️' : '🤍') + ' <span>' + (r.likes || '') + '</span> ' + esc(T('feed_like', 'Like'));
      } catch (e) {}
      like.disabled = false;
    };

    el.querySelector('[data-a="share"]').onclick = function () {
      if (target) compose({ shared: target, onPosted: ctx && ctx.onPosted });
    };

    var cbox = el.querySelector('.mvf-comments');
    var cbtn = el.querySelector('[data-a="comment"]');
    function drawComments(list) {
      p.comments = list.length;
      cbtn.querySelector('span').textContent = list.length || '';
      cbox.innerHTML = list.map(function (c) {
        return '<div class="mvf-cm" data-id="' + c.id + '">' + avatar(c.author, 30)
          + '<div class="mvf-cm-body"><div class="mvf-cm-name">' + esc(c.author ? c.author.display_name : T('feed_deleted_user', 'Deleted profile')) + '</div>'
          + '<div class="mvf-cm-text">' + richText(c.text) + '</div>'
          + '<div class="mvf-cm-time"><span>' + esc(ago(c.created_at)) + '</span>'
          + (c.can_delete ? '<button type="button" data-del="' + c.id + '">' + esc(T('feed_delete', 'Delete')) + '</button>' : '')
          + '</div></div></div>';
      }).join('')
        + '<form class="mvf-cm-form">' + avatar(ctx && ctx.me, 30)
        + '<input class="mvf-inp" maxlength="2000" placeholder="' + esc(T('feed_comment_ph', 'Write a comment…')) + '">'
        + '<button class="mvf-btn" type="submit">' + esc(T('feed_send', 'Send')) + '</button></form>';
      cbox.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = async function () {
          if (!confirm(T('feed_delete_comment_confirm', 'Delete this comment?'))) return;
          try {
            await api('/comments/' + b.dataset.del, { method: 'DELETE' });
            drawComments(list.filter(function (c) { return String(c.id) !== b.dataset.del; }));
          } catch (e) { alert(e.message); }
        };
      });
      var form = cbox.querySelector('form'), inp = form.querySelector('input');
      form.onsubmit = async function (e) {
        e.preventDefault();
        var text = inp.value.trim();
        if (!text) return;
        inp.disabled = true;
        try {
          drawComments(await api('/post/' + p.id + '/comments', { method: 'POST', json: { text: text } }));
          cbox.querySelector('form input').focus();
        } catch (e2) { inp.disabled = false; alert(e2.message); }
      };
    }
    cbtn.onclick = async function () {
      if (!cbox.hidden) { cbox.hidden = true; return; }
      cbox.hidden = false;
      try { drawComments(await api('/post/' + p.id + '/comments')); } catch (e) { cbox.hidden = true; }
      var inp = cbox.querySelector('form input');
      if (inp) inp.focus();
    };
    return el;
  }

  // ── The feed ─────────────────────────────────────────────────────────
  /* opts: {me, onSeen()} */
  function mount(container, opts) {
    opts = opts || {};
    ensureStyle();
    container.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'mvf-root';
    container.appendChild(root);

    var me = opts.me || {};
    var start = document.createElement('div');
    start.className = 'mvf-card mvf-start';
    start.innerHTML = avatar(me, 40) + '<div class="mvf-start-box">' + esc(T('feed_compose_ph', 'What would you like to share?')) + '</div><button class="mvf-tool mvf-start-photo" type="button" title="' + esc(T('feed_add_photo', 'Add photos')) + '">📷</button>'
      + '<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden>';
    root.appendChild(start);

    var newBtn = document.createElement('button');
    newBtn.className = 'mvf-btn mvf-new';
    newBtn.type = 'button';
    newBtn.hidden = true;
    root.appendChild(newBtn);

    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:14px';
    root.appendChild(list);

    var more = document.createElement('button');
    more.className = 'mvf-btn mvf-btn-ghost mvf-more';
    more.type = 'button';
    more.textContent = T('feed_load_more', 'Show older posts');
    more.hidden = true;
    root.appendChild(more);

    var oldest = 0, newest = 0, apps = {}, alive = true;
    var ctx = { me: me, onPosted: function (post) { prepend(post); } };

    function prepend(post) {
      var empty = list.querySelector('.mvf-empty');
      if (empty) empty.remove();
      list.insertBefore(renderPost(post, apps, ctx), list.firstChild);
      if (post.id > newest) { newest = post.id; markSeen(); }
    }

    function markSeen() {
      if (!newest) return;
      api('/seen', { method: 'POST', json: { id: newest } }).then(function () {
        if (opts.onSeen) opts.onSeen();
      }).catch(function () {});
    }

    async function load(older) {
      more.disabled = true;
      try {
        apps = await loadApps();
        var r = await api('?limit=20' + (older && oldest ? '&before=' + oldest : ''));
        if (!older) list.innerHTML = '';
        r.posts.forEach(function (p) {
          list.appendChild(renderPost(p, apps, ctx));
          if (!oldest || p.id < oldest) oldest = p.id;
          if (p.id > newest) newest = p.id;
        });
        if (!older && !r.posts.length) {
          list.innerHTML = '<div class="mvf-card mvf-empty">' + esc(T('feed_empty', 'No posts yet. Share something, or add people to your favourites to see what they share with you.')) + '</div>';
        }
        more.hidden = r.posts.length < 20;
        if (!older) markSeen();
      } catch (e) {
        if (!older) list.innerHTML = '<div class="mvf-card mvf-empty">' + esc(e.message) + '</div>';
      }
      more.disabled = false;
    }

    start.onclick = function () { compose({ onPosted: ctx.onPosted }); };
    // The camera goes straight to picking photos; the picker has to open on
    // the click itself, so the post is written once they are chosen.
    var startFile = start.querySelector('input[type=file]');
    start.querySelector('.mvf-start-photo').onclick = function (e) { e.stopPropagation(); startFile.click(); };
    startFile.onclick = function (e) { e.stopPropagation(); };
    startFile.onchange = function () {
      var files = Array.prototype.slice.call(startFile.files);
      startFile.value = '';
      if (files.length) compose({ images: files, onPosted: ctx.onPosted });
    };
    more.onclick = function () { load(true); };
    newBtn.onclick = function () {
      newBtn.hidden = true; oldest = 0; newest = 0; load(false);
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    function onPosted(e) {
      if (alive && e.detail && !list.querySelector('[data-id="' + e.detail.id + '"]')) prepend(e.detail);
    }
    window.addEventListener('mvm-feed-posted', onPosted);

    load(false);
    return {
      // Something new arrived while the feed was open: offered, not forced in.
      notifyNew: function (count) {
        if (!count) return;
        newBtn.textContent = '↑ ' + T('feed_new_posts', 'New posts ({n})', { n: count });
        newBtn.hidden = false;
      },
      reload: function () { oldest = 0; newest = 0; load(false); },
      destroy: function () { alive = false; window.removeEventListener('mvm-feed-posted', onPosted); },
    };
  }

  window.MvmFeed = { compose: compose, mount: mount, T: T };
})();
