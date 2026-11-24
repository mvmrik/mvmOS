// ── News — mvmOS ─────────────────────────────────────────────────────────────
// What is new on mvmos.org, shown on the desktop. The backend does the asking
// (a few times a day) and remembers only the newest item it has seen; this file
// shows what is waiting, once, and offers the same choices the setup wizard has.
//
// The window opens BEHIND the open windows and flags its taskbar button instead
// of taking the screen: whoever is working is never interrupted by it.
//
// It never installs anything itself. Its buttons lead to the ordinary places —
// the update list, the App Store, the mvmOS update in Settings — so there is
// one way to update, not two.
//
// News and the update notification are alternatives, with news first: when an
// update is noticed the news about it is asked for, and if it is shown, the
// notification is not (see mvmos.js). Closing the news without acting simply
// means the notification comes with the next check.

const NewsFeed = (() => {

  const WINDOW_ID = 'newsfeed';
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = value => String(value ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let _items = [];     // newest first
  let _index = 0;
  let _prefs = null;
  let _canManage = false;
  let _body = null;    // the window's body while it is open
  let _apps = {};      // app id → store entry, for the Install / Update buttons

  // ── State ────────────────────────────────────────────────────────────────
  async function loadState() {
    try {
      const res = await fetch('/api/newsfeed');
      if (!res.ok) return null;
      const data = await res.json();
      _prefs = data.prefs;
      _canManage = !!data.can_manage;
      return data;
    } catch (_) { return null; }
  }

  async function savePrefs(patch) {
    Object.assign(_prefs, patch);
    try {
      const res = await fetch('/api/newsfeed/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) _prefs = (await res.json()).prefs;
    } catch (_) {}
  }

  // ── The choices, shared by the wizard step and the news window ───────────
  // Three kinds of news and one refinement of the third. The refinement only
  // means something while "changed apps" is on, so it is dimmed otherwise.
  function renderPrefs(host, { compact = false, onChange } = {}) {
    if (!_prefs) { host.innerHTML = ''; return; }
    const disabled = !_canManage;
    const row = (key, titleKey, descKey, extra = '') => `
      <div class="wiz-check news-pref${extra}">
        <label class="toggle"><input type="checkbox" data-pref="${key}"${_prefs[key] ? ' checked' : ''}${disabled ? ' disabled' : ''}><span class="toggle-slider"></span></label>
        <div>
          <div class="wiz-check-title">${esc(t(titleKey))}</div>
          ${compact ? '' : `<div class="wiz-check-desc">${esc(t(descKey))}</div>`}
        </div>
      </div>`;
    host.innerHTML = `
      ${row('core', 'news_pref_core', 'news_pref_core_desc')}
      ${row('new_apps', 'news_pref_new_apps', 'news_pref_new_apps_desc')}
      ${row('changed_apps', 'news_pref_changed_apps', 'news_pref_changed_apps_desc')}
      ${row('changed_all', 'news_pref_changed_all', 'news_pref_changed_all_desc', ' news-pref-sub')}
      ${disabled ? `<p class="wiz-note">${esc(t('news_pref_admin_only'))}</p>` : ''}`;
    const sub = host.querySelector('[data-pref="changed_all"]');
    const sync = () => {
      const on = !!_prefs.changed_apps && _canManage;
      if (sub) sub.disabled = !on;
      sub?.closest('.news-pref')?.classList.toggle('news-pref-off', !_prefs.changed_apps);
    };
    sync();
    host.querySelectorAll('[data-pref]').forEach(box => {
      box.addEventListener('change', async () => {
        await savePrefs({ [box.dataset.pref]: box.checked });
        sync();
        onChange?.(_prefs);
      });
    });
  }

  // ── Showing news ─────────────────────────────────────────────────────────
  // Called once the desktop is up and again now and then. Opening costs the
  // user nothing: it is a window behind the others.
  async function check() {
    const data = await loadState();
    if (!data || !data.can_manage || !data.items.length) return [];
    await (window.mvmOS?.i18nReady || Promise.resolve());
    // Whatever was waiting is handed over now, so it is not shown a second time.
    fetch('/api/newsfeed/seen', { method: 'POST' }).catch(() => {});
    const known = new Set(_items.map(i => i.id));
    const shown = data.items.filter(i => !known.has(i.id)).sort((a, b) => b.id - a.id);
    _items = [...shown, ..._items];
    _index = 0;
    open();
    return shown;
  }

  function open() {
    if (_body) { paint(); Desktop.flagWindow?.(WINDOW_ID); return; }
    Desktop.createWindow({
      id: WINDOW_ID,
      title: '📰 ' + t('news_window_title'),
      icon: '📰',
      width: 600,
      height: 640,
      background: true,
      onMount: body => {
        _body = body;
        body.classList.add('news-window');
        paint();
      },
      onClose: () => { _body = null; _items = []; _index = 0; },
    });
  }

  async function loadApps(ids) {
    const missing = ids.filter(id => !(id in _apps));
    if (!missing.length) return;
    try {
      const res = await fetch('/api/newsfeed/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: missing }),
      });
      const data = res.ok ? await res.json() : { apps: [] };
      missing.forEach(id => { _apps[id] = null; });
      (data.apps || []).forEach(app => { _apps[app.id] = app; });
    } catch (_) { missing.forEach(id => { _apps[id] = null; }); }
  }

  // Is a newer mvmOS waiting? The same check the update notification uses.
  let _osCheck = { at: 0, behind: false };
  async function systemUpdateWaiting() {
    if (Date.now() - _osCheck.at < 60000) return _osCheck.behind;
    try {
      const res = await fetch('/api/system/check-update');
      const d = res.ok ? await res.json() : null;
      _osCheck = { at: Date.now(), behind: !!d && d.up_to_date === false };
    } catch (_) { _osCheck = { at: Date.now(), behind: false }; }
    return _osCheck.behind;
  }

  async function formatDate(stamp) {
    if (!stamp) return '';
    try {
      const picker = window.mvmOS?.dateTimePicker;
      await picker.ready();
      const epoch = Date.parse(String(stamp).replace(' ', 'T') + 'Z') / 1000;
      return picker.format(picker.fromEpoch(epoch, { type: 'date' }), { type: 'date' });
    } catch (_) { return ''; }
  }

  async function paint() {
    if (!_body) return;
    const item = _items[_index];
    if (!item) return;
    const ids = [...new Set([...item.new, ...item.changed])];
    await loadApps(ids);
    const date = await formatDate(item.published_at);
    const coreWaiting = item.core && await systemUpdateWaiting();
    if (!_body || _items[_index] !== item) return;

    const appRow = (id, kindKey) => {
      const app = _apps[id];
      if (!app) return '';
      const icon = window.mvmOS?.iconHTML ? window.mvmOS.iconHTML(app) : esc(app.icon || '📦');
      const name = window.mvmOS?.appName ? window.mvmOS.appName(app) : app.name;
      return `<div class="news-app">
        <div class="news-app-icon">${icon}</div>
        <div class="news-app-info">
          <div class="news-app-name">${esc(name)}</div>
          <div class="news-app-kind">${esc(t(kindKey === 'new' ? 'news_new_app' : 'news_updated_app'))}</div>
        </div>
      </div>`;
    };
    const rows = [...item.new.map(id => appRow(id, 'new')), ...item.changed.map(id => appRow(id, 'changed'))].join('');
    const actions = [
      item.changed.some(id => _apps[id]) ? ['news-open-updates', 'news_open_updates'] : null,
      item.new.some(id => _apps[id]) ? ['news-open-store', 'news_open_store'] : null,
      coreWaiting ? ['news-core-update', 'news_update_core'] : null,
    ].filter(Boolean).map(([id, key]) =>
      `<button class="s-btn s-btn-primary s-btn-sm" id="${id}">${esc(t(key))}</button>`).join('');

    _body.innerHTML = `
      <div class="news-main">
        ${item.image ? `<img class="news-image" src="${esc(item.image)}" alt="" loading="lazy">` : ''}
        <div class="news-head">
          <div class="news-title">${item.url
            ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
            : esc(item.title)}</div>
          ${date ? `<div class="news-date">${esc(date)}</div>` : ''}
        </div>
        <div class="news-text">${esc(item.body)}</div>
        ${rows ? `<div class="news-apps">${rows}</div>` : ''}
        ${actions ? `<div class="news-actions">${actions}</div>` : ''}
        <div class="news-links">
          ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(t('news_read_more'))}</a>` : ''}
          <a href="https://mvmos.org/news" target="_blank" rel="noopener">${esc(t('news_all'))}</a>
        </div>
      </div>
      <div class="news-foot">
        ${_items.length > 1 ? `<div class="news-pager">
          <button class="s-btn s-btn-sm" id="news-newer"${_index === 0 ? ' disabled' : ''}>← ${esc(t('news_newer'))}</button>
          <span>${_index + 1} / ${_items.length}</span>
          <button class="s-btn s-btn-sm" id="news-older"${_index === _items.length - 1 ? ' disabled' : ''}>${esc(t('news_older'))} →</button>
        </div>` : ''}
        <details class="news-prefs">
          <summary>${esc(t('news_receive'))}</summary>
          <div id="news-prefs-host"></div>
        </details>
      </div>`;

    renderPrefs(_body.querySelector('#news-prefs-host'), { compact: true });
    _body.querySelector('#news-newer')?.addEventListener('click', () => { _index--; paint(); });
    _body.querySelector('#news-older')?.addEventListener('click', () => { _index++; paint(); });
    // Each button only opens the place where this is done every other time.
    _body.querySelector('#news-open-updates')?.addEventListener('click', () => UpdateManager.openWindow());
    _body.querySelector('#news-open-store')?.addEventListener('click', () => AppStore.openWindow());
    _body.querySelector('#news-core-update')?.addEventListener('click', () => Settings.openWindow('about'));
  }

  // An update has just been noticed: ask for the news that explains it now.
  // Resolves with the news items now on screen (none when there is nothing, or
  // the choices turned this kind off) — the caller shows its own notification
  // only when none of them covers the update.
  async function checkNow() {
    try { await fetch('/api/newsfeed/check', { method: 'POST' }); } catch (_) { return []; }
    await check();
    // Everything on screen counts, also news that arrived a moment earlier.
    return _body ? [..._items] : [];
  }

  return { check, checkNow, renderPrefs, loadState, open,
           get canManage() { return _canManage; },
           get prefs() { return _prefs; } };
})();

window.NewsFeed = NewsFeed;
