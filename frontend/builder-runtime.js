/*
 * mvmOS App Builder — the host that runs a generated app.
 *
 * A generated app never runs in the desktop's own page. It runs in an iframe
 * that is sandboxed (no same-origin access, so no cookies, storage or desktop
 * objects), locked by a Content-Security-Policy (no network at all) and given a
 * single door: postMessage. This file is the other side of that door. It
 * answers only the small list of operations below, checks every argument, and
 * talks to the server on the app's behalf.
 *
 * The same host serves three places: the preview inside App Builder, an
 * installed app's desktop window, and the app's public page (a copy of this
 * file is written next to an installed app so a public-only server has it).
 */
(function () {
  'use strict';

  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; " +
    "frame-src 'none'; object-src 'none'; worker-src 'none'";
  const MAX_KV_VALUE = 256 * 1024;
  const MAX_SAVE = 2 * 1024 * 1024;

  const T = (k, fb) => (window.t && window._i18n && window._i18n[k]) ? window.t(k) : (fb || k);
  const norm = p => String(p || '').split('#')[0].split('?')[0].replace(/^\.?\//, '').replace(/^\//, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── What the app sees of the theme ────────────────────────────────────────
  function pick(cs, names, fb) {
    for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) return v; }
    return fb;
  }
  function themeCss() {
    const cs = getComputedStyle(document.documentElement);
    const v = {
      bg: pick(cs, ['--bg', '--pub-bg'], '#0d1117'),
      surface: pick(cs, ['--surface', '--surface1', '--pub-surface1'], '#161b22'),
      surface2: pick(cs, ['--surface2', '--pub-surface2'], '#21262d'),
      border: pick(cs, ['--border', '--pub-border'], '#30363d'),
      text: pick(cs, ['--text', '--fg', '--pub-fg'], '#c9d1d9'),
      dim: pick(cs, ['--text-dim', '--fg2', '--pub-fg2', '--pub-dim'], '#8b949e'),
      accent: pick(cs, ['--accent', '--pub-accent'], '#2a6ee0'),
      onAccent: pick(cs, ['--on-accent'], '#ffffff'),
      danger: pick(cs, ['--danger', '--red', '--pub-red'], '#da3633'),
      font: pick(cs, ['--font'], "system-ui, 'Segoe UI', sans-serif"),
    };
    return ':root{--bg:' + v.bg + ';--surface:' + v.surface + ';--surface2:' + v.surface2 + ';--border:' + v.border +
      ';--text:' + v.text + ';--text-dim:' + v.dim + ';--accent:' + v.accent + ';--on-accent:' + v.onAccent +
      ';--danger:' + v.danger + ';--font:' + v.font + '}' + BASE_CSS;
  }
  // Plain elements look at home without any styling from the app.
  const BASE_CSS =
    '*{box-sizing:border-box}html,body{margin:0;min-height:100%}' +
    'body{background:var(--bg);color:var(--text);font:15px/1.45 var(--font)}' +
    'h1,h2,h3{margin:.4em 0;line-height:1.2}a{color:var(--accent)}' +
    'button,input,select,textarea{font:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px}' +
    'button{cursor:pointer}button:hover:not(:disabled){border-color:var(--accent)}button:disabled{opacity:.5;cursor:default}' +
    'button.primary,.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}' +
    'button.danger,.danger{color:var(--danger);border-color:var(--danger)}' +
    'input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}' +
    '.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}' +
    '.muted{color:var(--text-dim)}::selection{background:var(--accent);color:var(--on-accent)}';

  // ── Putting the app's files together into one document ───────────────────
  function urlsToAssets(css, assets) {
    return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
      const a = assets[norm(u)];
      return a ? 'url("' + a + '")' : m;
    });
  }
  function safeScript(text) { return String(text).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'); }

  function buildDoc(bundle, boot, sdkText, css) {
    const doc = new DOMParser().parseFromString(bundle.html || '<!doctype html><title></title>', 'text/html');
    const assets = bundle.assets || {};
    doc.documentElement.lang = boot.lang;
    doc.querySelectorAll('link[rel~="stylesheet"]').forEach(l => {
      const text = (bundle.styles || {})[norm(l.getAttribute('href'))];
      if (text != null) { const s = doc.createElement('style'); s.textContent = urlsToAssets(text, assets); l.replaceWith(s); } else l.remove();
    });
    doc.querySelectorAll('script[src]').forEach(sc => {
      const text = (bundle.scripts || {})[norm(sc.getAttribute('src'))];
      const n = doc.createElement('script');
      if (text != null) n.textContent = safeScript(text);
      sc.replaceWith(n);
    });
    doc.querySelectorAll('style').forEach(s => { s.textContent = urlsToAssets(s.textContent, assets); });
    doc.querySelectorAll('[src],[poster]').forEach(el => {
      for (const attr of ['src', 'poster']) {
        const a = el.hasAttribute(attr) ? assets[norm(el.getAttribute(attr))] : null;
        if (a) el.setAttribute(attr, a);
      }
    });
    const head = doc.head;
    const first = head.firstChild;
    const add = n => head.insertBefore(n, first);
    const meta = doc.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', CSP);
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
    const theme = doc.createElement('style'); theme.id = 'mvm-theme'; theme.textContent = css;
    const bootEl = doc.createElement('script');
    bootEl.textContent = 'window.__MVM_BOOT=' + safeScript(JSON.stringify(boot).replace(/</g, '\\u003c')) + ';';
    const sdk = doc.createElement('script'); sdk.textContent = safeScript(sdkText);
    [meta, viewport, theme, bootEl, sdk].forEach(add);
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }

  let _sdkText = null;
  async function loadSdk(url) {
    if (_sdkText) return _sdkText;
    const r = await fetch(url || (window.asset ? window.asset('/builder-sdk.js') : '/builder-sdk.js'));
    if (!r.ok) throw new Error('SDK unavailable');
    _sdkText = await r.text();
    return _sdkText;
  }

  function headers(o, extra) {
    const h = (o.api.headers ? o.api.headers() : {}) || {};
    return Object.assign({}, h, extra || {});
  }
  async function api(o, method, path, body) {
    const init = { method, headers: headers(o, body !== undefined ? { 'Content-Type': 'application/json' } : null) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(o.api.base + path, init);
    let data = null;
    try { data = await r.json(); } catch (e) { /* empty body */ }
    if (!r.ok) {
      const err = new Error((data && (data.detail || data.error)) || ('HTTP ' + r.status));
      err.status = r.status;
      throw err;
    }
    return data;
  }

  function regional() {
    try {
      const dp = window.mvmOS && window.mvmOS.dateTimePicker;
      if (dp && dp.settings) return dp.settings();
    } catch (e) { /* defaults */ }
    return { lang: 'en', dateFormat: 'DD/MM/YYYY', timeFormat: '24', timeZone: 'UTC', weekStarts: 'monday' };
  }
  const currentLang = () => (window.mvmOS && window.mvmOS.lang) || document.documentElement.lang || 'en';

  // ── Mount ────────────────────────────────────────────────────────────────
  async function mount(container, o) {
    o = Object.assign({ mode: 'preview', api: { base: '', headers: null }, game: null }, o);
    const dp = window.mvmOS && window.mvmOS.dateTimePicker;
    if (dp && dp.ready) { try { await dp.ready(); } catch (e) { /* defaults */ } }
    const getBundle = o.bundle ? Promise.resolve(o.bundle) : api(o, 'GET', '/bundle');
    const [bundle, sdkText] = await Promise.all([getBundle, loadSdk(o.sdkUrl)]);
    const iframe = document.createElement('iframe');
    // allow-forms only lets a <form> fire its submit event; the CSP form-action 'none' still stops any real submission.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    iframe.setAttribute('csp', CSP);
    iframe.setAttribute('allow', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.title = bundle.name || o.appId || '';
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
    let dead = false;
    let lastCss = themeCss();
    const boot = {
      appId: o.appId || '', defaultLang: bundle.default_lang || 'en', lang: currentLang(), regional: regional(), i18n: bundle.i18n || {}, assets: bundle.assets || {},
      user: o.user || { name: '' },
      game: o.game ? { player: o.game.player || null } : null,
      room: o.room ? { me: o.room.me || '' } : null,
    };
    iframe.srcdoc = buildDoc(bundle, boot, sdkText, lastCss);

    const post = (m) => { try { iframe.contentWindow && iframe.contentWindow.postMessage(Object.assign({ mvm: 1 }, m), '*'); } catch (e) { /* gone */ } };
    const reply = (id, ok, v) => post(ok ? { id, ok: true, result: v === undefined ? null : v } : { id, ok: false, error: String(v && v.message || v || 'failed').slice(0, 300) });

    let readyHook = null;
    const ops = {
      hello: async () => { if (readyHook) setTimeout(readyHook, 0); return true; },
      'kv.get': async a => { if (o.kv) return o.kv.get(needKey(a.key)); const r = await api(o, 'GET', '/kv/' + encodeURIComponent(needKey(a.key))).catch(e => { if (e.status === 404) return { value: null }; throw e; }); return r.value; },
      'kv.set': async a => {
        const k = needKey(a.key);
        const s = JSON.stringify(a.value === undefined ? null : a.value);
        if (s.length > MAX_KV_VALUE) throw new Error('Value too large');
        if (o.kv) return o.kv.set(k, a.value === undefined ? null : a.value);
        await api(o, 'PUT', '/kv/' + encodeURIComponent(k), { value: a.value === undefined ? null : a.value });
        return true;
      },
      'kv.remove': async a => { if (o.kv) return o.kv.remove(needKey(a.key)); await api(o, 'DELETE', '/kv/' + encodeURIComponent(needKey(a.key))); return true; },
      'kv.list': async a => o.kv ? o.kv.list(String(a.prefix || '').slice(0, 100)) : (await api(o, 'GET', '/kv?prefix=' + encodeURIComponent(String(a.prefix || '').slice(0, 100)))).items || [],
      notify: async a => { notify(String(a.title || '').slice(0, 120), String(a.body || '').slice(0, 400)); return true; },
      toast: async a => { toast(String(a.text || '').slice(0, 200), String(a.body || '').slice(0, 400)); return true; },
      confirm: async a => confirmDialog(String(a.text || '').slice(0, 500), a.options || {}),
      prompt: async a => promptDialog(String(a.text || '').slice(0, 300), String(a.placeholder || '').slice(0, 100), String(a.value || '').slice(0, 500)),
      copy: async a => copyText(String(a.text || '').slice(0, 100000)),
      save: async a => saveFile(String(a.filename || 'file.txt'), String(a.text || ''), String(a.mime || 'text/plain')),
      pickDateTime: async a => pickDateTime(a),
      'apps.list': async () => o.noApps ? [] : ((await api(o, 'GET', '/apps')).apps || []),
      'apps.call': async a => {
        const app = String(a.app || ''), fn = String(a.fn || '');
        if (o.noApps) throw new Error('Other apps are not available here');
        if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(app) || !/^[a-z][a-z0-9_]{0,60}$/.test(fn)) throw new Error('Invalid call');
        return (await api(o, 'POST', '/apps/' + app + '/' + fn, { args: a.args && typeof a.args === 'object' ? a.args : {} })).result;
      },
      server: async a => {
        const method = String(a.method || 'GET').toUpperCase();
        const path = String(a.path || '');
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method) || !/^\/[A-Za-z0-9_\-./%?&=,:+@]{0,200}$/.test(path) || path.includes('..')) throw new Error('Invalid server path');
        if (!o.serverBase) throw new Error('The server part of this app works after it is installed.');
        const init = { method, headers: headers(o, a.body !== undefined && method !== 'GET' && method !== 'DELETE' ? { 'Content-Type': 'application/json' } : null) };
        if (init.headers['Content-Type']) { const raw = JSON.stringify(a.body); if (raw.length > MAX_KV_VALUE) throw new Error('Too much data'); init.body = raw; }
        const r = await fetch(o.serverBase + '/x' + path, init);
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text.slice(0, 20000); }
        if (!r.ok) throw new Error((data && (data.detail || data.error)) || ('HTTP ' + r.status));
        return data;
      },
      'room.send': async a => {
        if (!o.room) throw new Error('This app has no room');
        const raw = JSON.stringify(a.data === undefined ? null : a.data);
        if (raw.length > 64 * 1024) throw new Error('Message too large');
        return o.room.send(JSON.parse(raw));
      },
      'game.finish': async a => {
        if (!o.game || !o.game.finish) return { recorded: false };
        const score = Number(a.score), seconds = Number(a.seconds);
        const stats = {};
        if (a.stats && typeof a.stats === 'object') {
          Object.keys(a.stats).slice(0, 40).forEach(k => { if (/^[a-z][a-z0-9_]{0,31}$/.test(k) && Number.isFinite(Number(a.stats[k]))) stats[k] = Number(a.stats[k]); });
        }
        return o.game.finish({ score: Number.isFinite(score) ? score : 0, seconds: Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0, stats });
      },
    };
    function needKey(k) {
      k = String(k == null ? '' : k);
      if (!k || k.length > 100) throw new Error('Invalid key');
      return k;
    }

    function onMessage(ev) {
      if (dead || ev.source !== iframe.contentWindow) return;
      const m = ev.data;
      if (!m || m.mvm !== 1 || typeof m.op !== 'string') return;
      if (m.op === 'report') { if (o.onReport && m.args) o.onReport({ message: String(m.args.message || ''), stack: String(m.args.stack || '') }); return; }
      const fn = Object.prototype.hasOwnProperty.call(ops, m.op) ? ops[m.op] : null;
      if (!fn) { reply(m.id, false, 'Unknown operation'); return; }
      Promise.resolve().then(() => fn(m.args || {})).then(r => reply(m.id, true, r), e => reply(m.id, false, e));
    }
    window.addEventListener('message', onMessage);

    // Theme and language follow the desktop while the app is open.
    const timer = setInterval(() => {
      if (dead) return;
      const css = themeCss();
      if (css !== lastCss) { lastCss = css; post({ event: 'theme', css }); }
    }, 1500);
    const langFn = () => post({ event: 'lang', lang: currentLang(), regional: regional() });
    window.addEventListener('i18n-loaded', langFn);
    window.addEventListener('settings-changed', langFn);
    if (window.mvmOS && window.mvmOS.onLangChange) try { window.mvmOS.onLangChange(langFn); } catch (e) { /* optional */ }

    // Room events wait until the page has loaded its SDK, so none is lost while the iframe starts.
    let frameReady = false;
    const roomQueue = [];
    const sendRoom = ev => { const m = Object.assign({ event: 'room' }, ev); if (frameReady) post(m); else roomQueue.push(m); };
    readyHook = () => { frameReady = true; roomQueue.splice(0).forEach(post); };
    const unsubscribe = o.room && o.room.subscribe ? o.room.subscribe(sendRoom) : null;
    container.appendChild(iframe);
    return {
      iframe,
      reload() { iframe.srcdoc = buildDoc(bundle, boot, sdkText, lastCss); },
      destroy() {
        dead = true; clearInterval(timer); if (unsubscribe) unsubscribe();
        window.removeEventListener('message', onMessage);
        window.removeEventListener('i18n-loaded', langFn);
        window.removeEventListener('settings-changed', langFn);
        iframe.remove();
      },
    };
  }

  // ── The operations the app may ask for ────────────────────────────────────
  function toast(text, body) {
    if (window.mvmOS && window.mvmOS.toast) return window.mvmOS.toast(text, body);
    const el = document.createElement('div');
    el.textContent = body ? text + ' — ' + body : text;
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--surface2,#222);color:var(--text,#fff);padding:10px 16px;border-radius:10px;z-index:99999;box-shadow:0 4px 18px rgba(0,0,0,.4)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  function notify(title, body) {
    if (window.mvmOS && window.mvmOS.notify) return window.mvmOS.notify(title, body);
    toast(title, body);
  }
  async function confirmDialog(text, options) {
    if (window.mvmOS && window.mvmOS.confirm) {
      return !!(await window.mvmOS.confirm(text, { ok: String(options.ok || '').slice(0, 40) || undefined, cancel: String(options.cancel || '').slice(0, 40) || undefined, danger: !!options.danger }));
    }
    return window.confirm(text);
  }
  async function promptDialog(text, placeholder, value) {
    if (window.mvmOS && window.mvmOS.prompt) { const r = await window.mvmOS.prompt(text, placeholder, value); return r == null ? null : String(r); }
    return window.prompt(text, value);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function saveFile(filename, text, mime) {
    if (text.length > MAX_SAVE) throw new Error('File too large');
    const name = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file.txt';
    const safeMime = /^(text\/plain|text\/csv|application\/json|text\/markdown|text\/html)$/.test(mime) ? mime : 'text/plain';
    const url = URL.createObjectURL(new Blob([text], { type: safeMime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
  function pickDateTime(a) {
    const dp = window.mvmOS && window.mvmOS.dateTimePicker;
    if (!dp || !dp.create) return Promise.resolve(null);
    const type = ['date', 'time', 'datetime'].includes(a.type) ? a.type : 'date';
    const text = x => (typeof x === 'string' && x.length <= 40 ? x : undefined);
    return new Promise(resolve => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(host);
      let picked, h;
      try {
        h = dp.create(host, { type, value: text(a.value) || '', min: text(a.min), max: text(a.max), label: text(a.label), onChange: v => { picked = v || null; } });
      } catch (e) { host.remove(); resolve(null); return; }
      const finish = () => { clearInterval(w); try { h.destroy(); } catch (e) { /* done */ } host.remove(); resolve(picked === undefined ? null : picked); };
      const w = setInterval(() => { if (!document.querySelector('dialog.mvm-picker')) finish(); }, 150);
      Promise.resolve(h.open()).catch(finish);
    });
  }

  // ── An installed app in its desktop window ────────────────────────────────
  function openInstalled(def) {
    const base = '/api/apps/' + def.id;
    mvmOS.createWindow({
      id: def.id, title: def.name, icon: def.icon, width: def.width || 960, height: def.height || 660,
      onMount(body) {
        body.style.cssText = 'padding:0;overflow:hidden;height:100%';
        let handle = null, gone = false;
        const user = { name: '' };
        (async () => {
          try {
            const h = window.mvmOS && window.mvmOS._pubHeaders ? window.mvmOS._pubHeaders() : {};
            if (h['X-Pub-Token']) {
              const r = await fetch('/api/pub/apphub/me', { headers: h });
              if (r.ok) { const me = await r.json(); user.name = me.display_name || me.username || ''; }
            }
          } catch (e) { /* anonymous */ }
          if (gone) return;
          try {
            handle = await mount(body, {
              appId: def.id, mode: 'installed', user,
              serverBase: base,
              api: { base, headers: () => (window.mvmOS && window.mvmOS._pubHeaders ? window.mvmOS._pubHeaders() : {}) },
            });
            if (gone) handle.destroy();
          } catch (e) {
            body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">' + esc(e.message || e) + '</div>';
          }
        })();
        const observer = new MutationObserver(() => { if (!body.isConnected) { gone = true; if (handle) handle.destroy(); observer.disconnect(); } });
        observer.observe(document.body, { childList: true, subtree: true });
      },
    });
  }

  window.BuilderRuntime = { mount, openInstalled, buildDoc, themeCss, CSP };
})();
