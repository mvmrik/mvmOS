// System programs an app needs. Before an app opens, mvmOS asks the server what it needs and what is missing;
// when something is missing this window lists it and installs it with the output of the installation shown in a
// terminal. When everything is there the window closes and the app starts. The same window answers a backend
// that finds a program missing in the middle of a request (see missing_dependency in backend/deps.py).
(function () {
  const t = (k) => (window._i18n && window._i18n[k]) || k;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pending = new Map(); // a window per set of programs, however many requests wait for it

  function purpose(item) {
    const key = 'deps_p_' + item.id;
    return window._i18n && window._i18n[key] ? window._i18n[key] : '';
  }

  async function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // target: {app: id} or {ids: [...]}. Resolves true when nothing is missing any more.
  function show(target, status, title) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99998;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
      const rows = status.missing.map((m) => `
        <div style="padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface2)">
          <div style="font-weight:600;font-size:.88rem">${esc(m.name)}</div>
          ${purpose(m) ? `<div style="font-size:.8rem;color:var(--text-dim);margin-top:2px">${esc(purpose(m))}</div>` : ''}
          <div style="font-size:.74rem;color:var(--text-dim);margin-top:4px;font-family:monospace">${esc(m.commands.join(', '))}${m.packages.length ? ' — ' + esc(t('deps_package')) + ': ' + esc(m.packages.join(' ')) : ''}</div>
        </div>`).join('');
      ov.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:22px;max-width:620px;width:100%;max-height:92vh;overflow:auto;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px;box-sizing:border-box">
          <div style="font-size:1.05rem;font-weight:700">🧩 ${esc(title)}</div>
          <div style="font-size:.85rem;color:var(--text-dim)">${esc(status.program || status.manager ? t('deps_intro') : t('deps_no_manager'))}</div>
          <div id="_dp-list" style="display:flex;flex-direction:column;gap:6px">${rows}</div>
          <div id="_dp-term" style="display:none;height:260px;background:#0d1117;border-radius:4px;padding:4px;box-sizing:border-box"></div>
          <div id="_dp-msg" style="font-size:.82rem;min-height:18px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_dp-close" class="s-btn s-btn-sm">${esc(t('deps_close'))}</button>
            <button id="_dp-ok" class="s-btn s-btn-sm s-btn-primary">${esc(t('deps_install'))}</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const msg = ov.querySelector('#_dp-msg');
      const ok = ov.querySelector('#_dp-ok');
      const close = ov.querySelector('#_dp-close');
      const termBox = ov.querySelector('#_dp-term');
      let term = null, fit = null, ws = null, running = false, ro = null;

      const finish = (result) => {
        try { ws && ws.close(); } catch (_) {}
        try { ro && ro.disconnect(); } catch (_) {}
        try { term && term.dispose(); } catch (_) {}
        ov.remove();
        resolve(result);
      };
      const say = (text, bad) => {
        msg.textContent = text;
        msg.style.color = bad ? 'color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9))' : 'var(--text)';
      };
      close.onclick = () => { if (!running) finish(false); };

      if (!status.installable) {
        ok.style.display = 'none';
        say(status.manager ? t('deps_no_package') : t('deps_no_manager'), true);
        return;
      }
      if (!status.root) say(t('deps_need_admin'));

      async function recheck() {
        const url = checkUrl(target);
        const res = await fetch(url).then((r) => r.json()).catch(() => null);
        return res && !res.missing.length;
      }

      ok.onclick = async () => {
        if (running) return;
        running = true; ok.disabled = true; close.disabled = true;
        say(t('deps_installing'));
        const res = await post('/api/deps/start', target).catch(() => null);
        if (!res || !res.ok) {
          running = false; ok.disabled = false; close.disabled = false;
          const j = res ? await res.json().catch(() => ({})) : {};
          say(j.detail === 'admin_required' || (res && res.status === 403) ? t('deps_need_admin') : t('deps_failed'), true);
          return;
        }
        const j = await res.json();
        if (j.nothing) { finish(true); return; }
        termBox.style.display = 'block';
        term = new window.Terminal({
          fontFamily: "'Consolas', 'Menlo', 'Courier New', monospace", fontSize: 13, lineHeight: 1.2,
          theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#0d1117' },
          cursorBlink: false, disableStdin: true, scrollback: 5000, convertEol: true,
        });
        fit = new window.FitAddon.FitAddon();
        term.loadAddon(fit);
        term.open(termBox);
        try { fit.fit(); } catch (_) {}
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/deps/install?ticket=${encodeURIComponent(j.ticket)}`);
        ws.binaryType = 'arraybuffer';
        let done = false;
        const sendSize = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols })); };
        ws.onopen = sendSize;
        ro = new ResizeObserver(() => { try { fit.fit(); } catch (_) {} sendSize(); });
        ro.observe(termBox);
        const after = async (code) => {
          if (done) return;
          done = true; running = false; close.disabled = false;
          if (code === 0 && await recheck()) {
            say(t('deps_done'));
            setTimeout(() => finish(true), 900);
          } else {
            ok.disabled = false; ok.textContent = t('deps_retry');
            say(t('deps_failed'), true);
          }
        };
        ws.onmessage = (e) => {
          if (typeof e.data === 'string') {
            let m = {};
            try { m = JSON.parse(e.data); } catch (_) {}
            if (m.type === 'done') after(m.code);
          } else {
            term.write(new Uint8Array(e.data));
          }
        };
        ws.onclose = () => after(-1);
      };
    });
  }

  function checkUrl(target) {
    if (target.apps) return '/api/deps/check?apps=' + encodeURIComponent(target.apps.join(','));
    if (target.app) return '/api/deps/check?app=' + encodeURIComponent(target.app);
    return '/api/deps/check?ids=' + encodeURIComponent((target.ids || []).join(','));
  }

  async function run(target, title) {
    const url = checkUrl(target);
    const status = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!status || !status.missing.length) return true;
    return show(target, status, title);
  }

  function once(key, make) {
    if (!pending.has(key)) pending.set(key, make().finally(() => pending.delete(key)));
    return pending.get(key);
  }

  window.mvmOS = window.mvmOS || {};
  window.mvmOS.deps = {
    // Before an app opens: true when it can start.
    ensureApp(appId, appName) {
      return once('app:' + appId, () => run({ app: appId }, t('deps_title').replace('{app}', appName || appId)));
    },
    // After apps were installed or updated: one window for everything the given apps need.
    ensureApps(appIds) {
      const list = [...new Set(appIds || [])].sort();
      if (!list.length) return Promise.resolve(true);
      return once('apps:' + list.join(','), () => run({ apps: list }, t('deps_title_generic')));
    },
    // A backend asked for programs by id while serving a request: true when they are installed now.
    ask(ids) {
      const list = [...new Set(ids || [])].sort();
      return once('ids:' + list.join(','), () => run({ ids: list }, t('deps_title_generic')));
    },
  };
})();
