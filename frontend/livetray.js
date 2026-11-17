// Happening now + recent activity on the desktop. The same things the Apps
// Hub profile shows on its public pages (a running timer, the latest actions
// in apps), reachable from the taskbar button beside the bell, or from the
// side panel on a phone. Nothing is stored here: the live items come from
// /api/pub/apphub/live and the recent actions from the list the public pages
// keep in this browser. The button exists only while there is something to show.
const LiveTray = (() => {
  const TOKEN_KEY = 'apphub_token';
  const ACTIVITY_KEY = 'apphub_activity';
  const ACTIVITY_MS = 7 * 86400000;
  const LIVE_ACT = {
    pause:  ['⏸', 'ah_live_act_pause', 'Pause'],
    resume: ['▶', 'ah_live_act_resume', 'Resume'],
    stop:   ['⏹', 'ah_live_act_stop', 'Stop'],
    done:   ['✓', 'ah_live_act_done', 'Done'],
  };

  let live = [];
  let liveAt = 0;
  let apps = {};
  let appsLoaded = false;
  let userId = null;
  let loadedToken = '';
  let open = false;
  let tick = null;
  let panel = null;

  const T = (k, fb) => { const s = window.t ? window.t(k) : k; return s && s !== k ? s : fb; };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const token = () => localStorage.getItem(TOKEN_KEY) || '';
  const fsMode = () => document.body.classList.contains('fs-mode');

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const p = n => (n < 10 ? '0' : '') + n;
    return (h ? h + ':' : '') + p(m) + ':' + p(s);
  }

  function activity() {
    if (!token() || !userId || token() !== loadedToken) return [];
    let list = [];
    try { list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter(a => a && a.app && a.u === userId && now - new Date(a.at).getTime() < ACTIVITY_MS);
  }

  function actionLabel(a) {
    const s = String(a || '').replace(/^_+/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ')
      .replace(/\b(pub|public|api|endpoint|route|handler)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function when(iso) {
    try {
      const d = new Date(iso), lang = (window.mvmOS && window.mvmOS.lang) || undefined;
      const picker = window.mvmOS && window.mvmOS.dateTimePicker;
      return picker ? picker.format(picker.fromEpoch(d.getTime() / 1000), { type: 'datetime' }) : d.toLocaleString(lang);
    } catch (e) { return ''; }
  }

  function appInfo(id) {
    const a = apps[id];
    return { icon: (a && a.icon) || '📦', name: (a && a.name) || id };
  }

  async function loadApps() {
    if (appsLoaded) return;
    appsLoaded = true;
    try {
      const [list, brand] = await Promise.all([
        fetch('/api/pub/apphub/apps', { headers: { 'X-Pub-Token': token() } }).then(r => r.ok ? r.json() : []),
        fetch('/api/pub/apphub/branding').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      ]);
      const names = (brand && brand.names) || {};
      (list || []).forEach(a => {
        apps[a.id] = {
          icon: a.icon || '📦',
          name: names[a.id] || (window.mvmOS && window.mvmOS.appName ? window.mvmOS.appName(a) : a.name) || a.id,
        };
      });
    } catch (e) { appsLoaded = false; }
  }

  function liveRow(it, idx) {
    const shown = it.elapsed_seconds == null ? '' : clock(it.elapsed_seconds + (it.state === 'running' ? (Date.now() - liveAt) / 1000 : 0));
    const state = it.state === 'paused' ? T('ah_live_paused', 'Paused') : T('ah_live_running', 'Running');
    const acts = (it.actions || []).map((a, n) => {
      const d = LIVE_ACT[a.type];
      return d ? `<button type="button" class="lt-act" data-i="${idx}" data-a="${n}" title="${esc(T(d[1], d[2]))}" aria-label="${esc(T(d[1], d[2]))}">${d[0]}</button>` : '';
    }).join('');
    return `<div class="lt-live"><a class="lt-live-row" href="/pub/${esc(it.app)}/" data-app="${esc(it.app)}">`
      + `<span class="lt-ico">${esc(it.icon)}</span>`
      + `<span class="lt-text"><span class="lt-title">${esc(it.title)}</span>`
      + `<span class="lt-state${it.state === 'paused' ? ' paused' : ''}">${esc(state)}</span></span>`
      + `<span class="lt-time" data-i="${idx}">${esc(shown)}</span></a>`
      + (acts ? `<div class="lt-acts">${acts}</div>` : '') + '</div>';
  }

  function activityRow(a) {
    const app = appInfo(a.app);
    const chips = (a.chips || []).slice(0, 4).join(' · ');
    return `<div class="lt-act-row${a.shared ? '' : ' can'}" data-id="${esc(a.id)}">`
      + `<span class="lt-ico">${esc(app.icon)}</span>`
      + '<span class="lt-text col">'
        + `<span class="lt-title">${esc(app.name)} · ${esc(actionLabel(a.action))}</span>`
        + (chips ? `<span class="lt-body">${esc(chips)}</span>` : '')
        + `<span class="lt-when">${esc(when(a.at))}</span>`
      + '</span>'
      + (a.shared
        ? `<span class="lt-shared" title="${esc(T('feed_shared_done', 'Shared'))}">✓</span>`
        : `<button type="button" class="lt-share" title="${esc(T('feed_share', 'Share'))}" aria-label="${esc(T('feed_share', 'Share'))}">↗</button>`)
      + '</div>';
  }

  function ensureStyle() {
    if (document.getElementById('lt-css')) return;
    const s = document.createElement('style');
    s.id = 'lt-css';
    s.textContent = `
#live-btn{position:relative;border:0;background:transparent;cursor:pointer;padding:4px 7px;border-radius:var(--radius);font-size:1rem;flex-shrink:0;color:inherit;font-family:inherit;transition:background .12s;user-select:none}
#live-btn:hover{background:var(--surface2)}
.lt-btn.live{box-shadow:0 0 0 2px #a6e3a1;background:color-mix(in srgb,#a6e3a1 22%,transparent)}
.lt-btn.live.paused{box-shadow:0 0 0 2px #f9e2af;background:color-mix(in srgb,#f9e2af 22%,transparent)}
.lt-btn.live:not(.paused){animation:lt-pulse 1.6s ease-in-out infinite}
@keyframes lt-pulse{50%{box-shadow:0 0 0 2px #a6e3a1,0 0 10px 3px #a6e3a1}}
.lt-btn.live:after{content:"";position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#a6e3a1;border:2px solid var(--surface)}
.lt-btn.live.paused:after{background:#f9e2af}
#live-panel{position:fixed;bottom:52px;right:8px;width:320px;max-width:calc(100vw - 16px);max-height:420px;overflow-y:auto;background:var(--surface);color:var(--text);
 border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:9400;display:none;flex-direction:column;font-size:.83rem}
#live-panel.open{display:flex}
#live-panel.fs-live-panel{top:10px;bottom:auto;right:84px;left:4px;width:auto;max-width:calc(100vw - 92px);max-height:calc(100dvh - 20px);z-index:10000}
.lt-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px 8px;font-size:.78rem;font-weight:700;color:var(--text-dim);border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.05em}
.lt-sec{background:var(--surface2);border-bottom:1px solid var(--border)}
.lt-live{display:flex;align-items:center}.lt-live+.lt-live{border-top:1px solid var(--border)}
.lt-live-row{display:flex;align-items:center;gap:8px;flex:1;min-width:0;min-height:42px;padding:3px 10px;color:var(--text);text-decoration:none}
.lt-ico{font-size:17px;line-height:1;flex-shrink:0}
.lt-text{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.lt-text.col{flex-direction:column;align-items:flex-start;gap:1px}
.lt-title{min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lt-state{display:flex;align-items:center;gap:4px;flex-shrink:0;font-size:10px;color:color-mix(in srgb,#a6e3a1 25%,var(--text))}
.lt-state:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.lt-state.paused{color:color-mix(in srgb,#f9e2af 25%,var(--text))}
.lt-time{font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.lt-acts{display:flex;gap:3px;padding:0 7px 0 0;flex-shrink:0}
.lt-act{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;font-size:14px}
.lt-act:hover{border-color:var(--accent)}.lt-act:disabled{opacity:.5}
.lt-act-row{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--border)}
.lt-act-row:last-child{border-bottom:none}
.lt-act-row.can{cursor:pointer}.lt-act-row.can:hover{background:var(--surface2)}
.lt-share{margin-left:auto;display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--accent);cursor:pointer;font-size:14px;flex-shrink:0}
.lt-shared{margin-left:auto;color:color-mix(in srgb,#a6e3a1 25%,var(--text));font-weight:700;flex-shrink:0}
.lt-new{border:0;background:none;color:var(--accent);font:inherit;font-weight:700;cursor:pointer;text-transform:none;letter-spacing:0}
.lt-body{font-size:.78rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lt-when{font-size:.7rem;color:var(--text-dim)}
.lt-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;font-size:.72rem;color:var(--text-dim)}
.lt-clear{cursor:pointer;border:0;background:none;color:var(--accent);font:inherit;font-weight:700}
.fs-tb-live-btn{background:none;border:none;color:var(--text);font-size:.75rem;cursor:pointer;padding:2px;position:relative;flex-shrink:0;border-radius:50%}
`;
    document.head.appendChild(s);
  }

  function buttons() {
    return [document.getElementById('live-btn'), document.getElementById('fs-live-btn')].filter(Boolean);
  }

  function hasContent() { return live.length > 0 || activity().length > 0; }

  function ensureButtons() {
    const show = hasContent();
    const bell = document.getElementById('notif-btn');
    let tb = document.getElementById('live-btn');
    if (show && !tb && bell) {
      tb = document.createElement('button');
      tb.id = 'live-btn';
      tb.type = 'button';
      tb.addEventListener('click', e => { e.stopPropagation(); toggle(); });
      bell.parentNode.insertBefore(tb, bell);
    }
    if (tb) tb.style.display = show ? '' : 'none';
    const hdr = document.querySelector('#fs-taskbar .fs-tb-header');
    let fb = document.getElementById('fs-live-btn');
    if (show && !fb && hdr) {
      fb = document.createElement('button');
      fb.id = 'fs-live-btn';
      fb.type = 'button';
      fb.className = 'fs-tb-live-btn';
      fb.addEventListener('touchend', e => { e.preventDefault(); toggle(); });
      fb.addEventListener('click', e => { e.stopPropagation(); toggle(); });
      hdr.insertBefore(fb, hdr.querySelector('#fs-notif-btn'));
    }
    if (fb) fb.style.display = show ? '' : 'none';
    const running = live.some(i => i.state !== 'paused');
    const label = live.length ? `${T('ah_live_title', 'Happening now')} · ${T('feed_activity_title', 'Recent activity')}` : T('feed_activity_title', 'Recent activity');
    buttons().forEach(b => {
      b.className = (b.id === 'fs-live-btn' ? 'fs-tb-live-btn ' : '') + 'lt-btn' + (live.length ? ' live' + (running ? '' : ' paused') : '');
      b.textContent = !live.length ? '🕘' : (running ? '▶️' : '⏸️');
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-expanded', String(open));
    });
    if (!show && open) close();
  }

  function render() {
    if (!panel) return;
    const list = activity();
    panel.innerHTML = `<div class="lt-hdr"><span>${esc(T('feed_activity_title', 'Recent activity'))}</span>`
      + `<button type="button" class="lt-new">✏️ ${esc(T('feed_new_post', 'New post'))}</button></div>`
      + (live.length ? `<div class="lt-sec">${live.map(liveRow).join('')}</div>` : '')
      + list.map(activityRow).join('')
      + `<div class="lt-foot"><span>${esc(T('feed_activity_hint', 'Only you see this list. It stays in this browser.'))}</span>`
      + (list.length ? `<button type="button" class="lt-clear">${esc(T('feed_activity_clear', 'Clear'))}</button>` : '') + '</div>';
    panel.querySelectorAll('.lt-act').forEach(b => { b.onclick = () => act(b); });
    panel.querySelectorAll('.lt-live-row').forEach(a => {
      a.onclick = e => {
        const id = a.dataset.app;
        e.preventDefault();
        close();
        // Opens in its desktop window; an app that is not installed here opens its public page instead.
        if (window.mvmOS && window.mvmOS._apps && window.mvmOS._apps[id]) window.mvmOS.openApp(id);
        else window.open(a.getAttribute('href'), '_blank', 'noopener');
      };
    });
    panel.querySelector('.lt-new').onclick = () => share(null);
    panel.querySelectorAll('.lt-act-row.can').forEach(row => {
      row.onclick = () => share(list.filter(a => a.id === row.dataset.id)[0]);
    });
    const clr = panel.querySelector('.lt-clear');
    if (clr) clr.onclick = () => {
      // Only this browser's list is cleared, as on the public pages.
      try {
        const all = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
        localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.filter(a => a && a.u !== userId)));
      } catch (e) {}
      refreshUi();
    };
  }

  // The composer and the wall are feed.js, the same file the public pages use.
  let feedLoading = null;
  function loadFeed() {
    if (window.MvmFeed) return Promise.resolve(window.MvmFeed);
    if (!feedLoading) {
      feedLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = window.asset ? window.asset('/pub/apphub/feed.js') : '/pub/apphub/feed.js';
        s.onload = () => resolve(window.MvmFeed);
        s.onerror = () => { feedLoading = null; reject(new Error('feed')); };
        document.head.appendChild(s);
      });
    }
    return feedLoading;
  }

  function share(entry) {
    close();
    loadFeed().then(feed => feed.compose({
      app_id: entry ? entry.app : '',
      chips: entry ? entry.chips : [],
      keys: entry ? entry.keys : null,
      labels: entry ? entry.labels : null,
      onPosted() {
        if (entry) {
          const list = activity();
          list.forEach(a => { if (a.id === entry.id) a.shared = true; });
          try {
            // Entries of other profiles or older than the list stay as they were.
            const all = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
            all.forEach(a => { if (a.id === entry.id) a.shared = true; });
            localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all));
          } catch (e) {}
          refreshUi();
        }
      },
    })).catch(() => {});
  }

  function refreshUi() {
    ensureButtons();
    render();
    if (live.length) { if (!tick) tick = setInterval(tickTimers, 1000); }
    else { clearInterval(tick); tick = null; }
  }

  function tickTimers() {
    if (document.hidden || !open) return;
    panel.querySelectorAll('.lt-time').forEach(n => {
      const it = live[+n.dataset.i];
      if (it && it.state === 'running' && it.elapsed_seconds != null) n.textContent = clock(it.elapsed_seconds + (Date.now() - liveAt) / 1000);
    });
  }

  async function act(btn) {
    const it = live[+btn.dataset.i], a = it && it.actions[+btn.dataset.a];
    if (!a) return;
    panel.querySelectorAll('.lt-act').forEach(b => { b.disabled = true; });
    try {
      const r = await fetch('/api/pub/apphub/live/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token() },
        body: JSON.stringify({ app: it.app, function: a.function, args: a.args }),
      });
      if (r.ok) { const d = await r.json(); live = d.items || []; liveAt = Date.now(); refreshUi(); return; }
    } catch (e) {}
    refresh();
  }

  async function refresh() {
    const activeToken = token();
    if (activeToken !== loadedToken) {
      loadedToken = activeToken; userId = null; live = []; apps = {}; appsLoaded = false; refreshUi();
    }
    if (!activeToken) { live = []; userId = null; refreshUi(); return; }
    try {
      if (!userId) {
        const me = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': activeToken } });
        const profile = me.ok ? await me.json() : null;
        if (activeToken !== token()) return;
        userId = profile && profile.id;
        if (!userId) { live = []; refreshUi(); return; }
      }
      const picker = window.mvmOS && window.mvmOS.dateTimePicker;
      if (picker) await picker.ready();
      const r = await fetch('/api/pub/apphub/live', { headers: { 'X-Pub-Token': activeToken } });
      if (activeToken !== token()) return;
      if (r.status === 401) { live = []; userId = null; }
      else if (r.ok) { const d = await r.json(); live = Array.isArray(d.items) ? d.items : []; liveAt = Date.now(); }
      else return;
    } catch (e) { return; }
    if (live.length || activity().length) await loadApps();
    refreshUi();
  }

  function toggle() { open ? close() : openPanel(); }

  function openPanel() {
    // One panel at a time: the notifications panel closes when this one opens.
    document.getElementById('notif-panel')?.classList.remove('open');
    panel.classList.toggle('fs-live-panel', fsMode());
    open = true;
    panel.classList.add('open');
    refresh().then(() => loadApps().then(render));
    refreshUi();
  }

  function close() {
    open = false;
    panel.classList.remove('open');
    buttons().forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function init() {
    ensureStyle();
    panel = document.createElement('div');
    panel.id = 'live-panel';
    document.body.appendChild(panel);
    panel.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', e => {
      if (open && !e.target.closest('#live-btn') && !e.target.closest('#fs-live-btn') && !e.target.closest('#live-panel')) close();
    });
    document.addEventListener('touchstart', e => {
      if (open && !e.target.closest('#fs-live-btn') && !e.target.closest('#live-panel')) close();
    }, { passive: true });
    // The side panel on a phone is built later and more than once.
    new MutationObserver(() => {
      if (document.querySelector('#fs-taskbar .fs-tb-header') && !document.getElementById('fs-live-btn')) ensureButtons();
    }).observe(document.body, { childList: true, subtree: false });
    window.addEventListener('storage', e => { if (e.key === ACTIVITY_KEY || e.key === TOKEN_KEY) refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    setTimeout(refresh, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { refresh };
})();
