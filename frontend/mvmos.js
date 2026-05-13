// mvmOS Plugin API
var mvmOS = (() => {
  const _apps = {};

  // ── Storage (namespaced localStorage) ────────────────────────────────────
  const storage = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(`mvmos_app_${key}`)); } catch { return null; }
    },
    set(key, value) {
      localStorage.setItem(`mvmos_app_${key}`, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(`mvmos_app_${key}`);
    },
  };

  // ── Flyout panel (two-level: categories → apps) ───────────────────────────
  let _flyout = null;

  function _closeFlyout() { _flyout?.remove(); _flyout = null; }

  function _openFlyout(anchorEl) {
    _closeFlyout();
    const rect = anchorEl.getBoundingClientRect();
    _flyout = document.createElement('div');
    _flyout.className = 'start-submenu open';
    _flyout.style.left = rect.right + 4 + 'px';
    _flyout.style.top  = rect.top + 'px';
    document.body.appendChild(_flyout);
    _renderCategories();
    const fr = _flyout.getBoundingClientRect();
    if (fr.bottom > window.innerHeight - 10) {
      _flyout.style.top = Math.max(8, window.innerHeight - fr.height - 10) + 'px';
    }
  }

  function _renderCategories() {
    if (!_flyout) return;
    _flyout.innerHTML = '';
    const cats = {};
    Object.values(_apps).forEach(app => {
      const cat = app.category || 'Utilities';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(app);
    });
    Object.keys(cats).sort().forEach(cat => {
      const el = document.createElement('div');
      el.className = 'start-submenu-item';
      el.innerHTML = `<span class="emoji">📂</span>${cat}<span class="start-menu-item-arrow">›</span>`;
      el.addEventListener('click', e => { e.stopPropagation(); _renderApps(cats[cat], cat); });
      _flyout.appendChild(el);
    });
  }

  function _renderApps(apps, catName) {
    if (!_flyout) return;
    _flyout.innerHTML = '';
    const back = document.createElement('div');
    back.className = 'start-submenu-item start-submenu-back';
    back.innerHTML = `<span class="emoji">‹</span>${catName}`;
    back.addEventListener('click', e => { e.stopPropagation(); _renderCategories(); });
    _flyout.appendChild(back);
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--border);margin:2px 0';
    _flyout.appendChild(sep);
    apps.forEach(app => {
      const el = document.createElement('div');
      el.className = 'start-submenu-item';
      el.innerHTML = `<span class="emoji">${app.icon}</span>${app.name}`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        _closeFlyout();
        document.getElementById('start-menu').classList.remove('open');
        fetch(`/api/plugins/${app.id}/open`, { method: 'POST' }).catch(() => {});
        app.launch();
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        _showCtxMenu(e.clientX, e.clientY, app);
      });
      _flyout.appendChild(el);
    });
  }

  // ── Start menu "Apps" entry ───────────────────────────────────────────────
  let _appsMenuItem = null;

  function _ensureAppsMenuItem() {
    const startMenu = document.getElementById('start-menu');
    if (!startMenu || _appsMenuItem) return;
    const sep = document.createElement('div');
    sep.className = 'start-menu-sep start-menu-apps-sep';
    _appsMenuItem = document.createElement('div');
    _appsMenuItem.className = 'start-menu-item';
    _appsMenuItem.id = 'start-apps-btn';
    _appsMenuItem.innerHTML = '<span class="emoji">⚡</span> Apps <span class="start-menu-item-arrow">›</span>';
    const anchor = startMenu.querySelector('.start-menu-user');
    startMenu.insertBefore(sep, anchor);
    startMenu.insertBefore(_appsMenuItem, anchor);
    _appsMenuItem.addEventListener('click', e => {
      e.stopPropagation();
      if (_flyout) { _closeFlyout(); } else { _openFlyout(_appsMenuItem); }
    });
  }

  function _removeAppsMenuItem() {
    _appsMenuItem?.remove();
    document.querySelector('.start-menu-apps-sep')?.remove();
    _appsMenuItem = null;
  }

  // ── Plugin registration ───────────────────────────────────────────────────
  function registerApp(def) {
    if (!def.id || !def.launch) { console.warn('mvmOS.registerApp: missing id or launch'); return; }
    _apps[def.id] = def;
    _ensureAppsMenuItem();
  }

  function _removeFromStartMenu(id) {
    delete _apps[id];
    _closeFlyout();
    if (!Object.keys(_apps).length) _removeAppsMenuItem();
  }

  // ── Widget registration & taskbar ─────────────────────────────────────────
  const _widgets = {};
  let _editMode = false;

  function registerWidget(def) {
    if (!def.id || !def.init) { console.warn('mvmOS.registerWidget: missing id or init'); return; }
    _widgets[def.id] = def;
    if (def.type === 'taskbar') _mountTaskbarWidget(def);
    else if (def.type === 'desktop') _mountDesktopWidget(def);
  }

  function _getTaskbarWidgetsEl() {
    let el = document.getElementById('taskbar-widgets');
    if (!el) {
      el = document.createElement('div');
      el.id = 'taskbar-widgets';
      el.style.cssText = 'display:flex;align-items:center;height:100%';
      const notifBtn = document.getElementById('notif-btn');
      if (notifBtn) notifBtn.parentNode.insertBefore(el, notifBtn);
      else document.getElementById('taskbar')?.appendChild(el);
    }
    return el;
  }

  function _mountTaskbarWidget(def) {
    if (def.type !== 'taskbar') return;
    const bar = _getTaskbarWidgetsEl();
    if (bar.querySelector(`[data-widget-id="${def.id}"]`)) return;
    const wrap = document.createElement('div');
    wrap.dataset.widgetId = def.id;
    wrap.style.cssText = 'display:flex;align-items:center;height:100%;position:relative';
    bar.appendChild(wrap);
    def.init(wrap);
    _applyEditMode(wrap);
  }

  function _applyEditMode(wrap) {
    wrap.style.cursor = _editMode ? 'grab' : 'default';
    if (_editMode) {
      wrap.style.outline = '1px dashed var(--border)';
    } else {
      wrap.style.outline = '';
    }
  }

  function _setEditMode(on) {
    _editMode = on;
    const bar = document.getElementById('taskbar-widgets');
    if (!bar) return;
    bar.querySelectorAll('[data-widget-id]').forEach(wrap => _applyEditMode(wrap));
    if (on) _enableDragSort(bar);
  }

  function _enableDragSort(bar) {
    let dragging = null;
    bar.querySelectorAll('[data-widget-id]').forEach(wrap => {
      wrap.draggable = true;
      wrap.addEventListener('dragstart', e => { dragging = wrap; wrap.style.opacity = '.4'; });
      wrap.addEventListener('dragend', e => {
        wrap.style.opacity = '';
        dragging = null;
        // save order
        const order = [...bar.querySelectorAll('[data-widget-id]')].map(w => w.dataset.widgetId);
        fetch('/api/widgets/reorder', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ order }) });
      });
      wrap.addEventListener('dragover', e => {
        e.preventDefault();
        if (dragging && dragging !== wrap) {
          const r = wrap.getBoundingClientRect();
          const mid = r.left + r.width / 2;
          if (e.clientX < mid) bar.insertBefore(dragging, wrap);
          else bar.insertBefore(dragging, wrap.nextSibling);
        }
      });
    });
  }

  // ── Desktop widgets ───────────────────────────────────────────────────────
  async function _mountDesktopWidget(def) {
    const desktop = document.getElementById('desktop');
    if (!desktop || desktop.querySelector(`[data-desktop-widget="${def.id}"]`)) return;

    // fetch saved position from API
    let x = def.defaultX ?? 20, y = def.defaultY ?? 20;
    try {
      const res = await fetch('/api/widgets');
      const list = await res.json();
      const saved = list.find(w => w.id === def.id);
      if (saved?.desktop_x != null) { x = saved.desktop_x; y = saved.desktop_y; }
    } catch(_) {}

    const wrap = document.createElement('div');
    wrap.dataset.desktopWidget = def.id;
    wrap.style.cssText = `position:absolute;left:${x}px;top:${y}px;z-index:10;user-select:none`;
    desktop.appendChild(wrap);
    def.init(wrap);

    // drag to move
    let dragging = false, ox = 0, oy = 0, saveTimer = null;
    wrap.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('button,input,select,a,canvas')) return;
      dragging = true;
      ox = e.clientX - wrap.offsetLeft;
      oy = e.clientY - wrap.offsetTop;
      wrap.style.zIndex = 50;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - wrap.offsetWidth));
      const ny = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - wrap.offsetHeight - 40));
      wrap.style.left = nx + 'px';
      wrap.style.top  = ny + 'px';
    });
    document.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      wrap.style.zIndex = 10;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        fetch(`/api/widgets/${def.id}/position`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ x: wrap.offsetLeft, y: wrap.offsetTop }),
        });
      }, 500);
    });
  }

  // ── Shared resource poller ────────────────────────────────────────────────
  const _resourceListeners = [];
  let _lastResources = null;

  async function _pollResources() {
    try {
      const [rRes, hRes] = await Promise.all([
        fetch('/api/system/resources'),
        fetch('/api/system/hardware'),
      ]);
      const r = await rRes.json();
      const h = await hRes.json();
      _lastResources = { ...r, ...h };
      _resourceListeners.forEach(fn => { try { fn(_lastResources); } catch(_) {} });
    } catch(_) {}
  }

  function _startResourcePoller() {
    _pollResources();
    setInterval(_pollResources, 3000);
  }

  function onResources(fn) {
    _resourceListeners.push(fn);
    if (_lastResources) fn(_lastResources);
  }

  function _removeWidget(id) {
    delete _widgets[id];
    document.querySelector(`[data-widget-id="${id}"]`)?.remove();
    document.querySelector(`[data-desktop-widget="${id}"]`)?.remove();
  }

  async function _loadWidget(id) {
    try {
      const res = await fetch(`/widgets/${id}/main.js?_=${Date.now()}`);
      if (!res.ok) {
        _pushNotif(`Widget needs reinstall: ${id}`, 'The widget files are missing. Please reinstall from the Widget Store.', null, null);
        return;
      }
      const code = await res.text();
      (new Function(code))();
    } catch (e) { console.error('mvmOS: failed to load widget', id, e); }
  }

  async function _loadAllWidgets() {
    try {
      const res = await fetch('/api/widgets');
      const widgets = await res.json();
      for (const w of widgets) await _loadWidget(w.id);
    } catch (e) { console.error('mvmOS: failed to load widgets', e); }
  }

  // ── Plugin loader (from /apps/{id}/main.js file) ──────────────────────────
  async function _loadPlugin(id) {
    try {
      const res = await fetch(`/apps/${id}/main.js?_=${Date.now()}`);
      if (!res.ok) {
        // file missing — app needs reinstall
        _pushNotif(
          `App needs reinstall: ${id}`,
          'The app files are missing. Please reinstall it from the App Store.',
          () => AppStore.openWindow('store-1'),
          'Open App Store'
        );
        return;
      }
      const code = await res.text();
      (new Function(code))();
    } catch (e) { console.error('mvmOS: failed to load plugin', id, e); }
  }

  async function _loadAllPlugins() {
    try {
      const res = await fetch('/api/plugins');
      const plugins = await res.json();
      for (const plugin of plugins) {
        await _loadPlugin(plugin.id);
      }
    } catch (e) { console.error('mvmOS: failed to load plugins', e); }
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  const _notifs = [];

  function _renderNotifPanel() {
    const panel = document.getElementById('notif-panel');
    const badge = document.getElementById('notif-badge');
    if (!panel) return;
    panel.innerHTML = `
      <div class="notif-header">
        Notifications
        <span class="notif-clear" id="notif-clear-all">Clear all</span>
      </div>
      ${_notifs.length === 0
        ? '<div class="notif-empty">No notifications</div>'
        : _notifs.map((n, i) => `
          <div class="notif-item">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-body">${n.body}</div>
            ${n.action ? `<span class="notif-item-action" data-notif-action="${i}">${n.actionLabel || 'Open'}</span>` : ''}
          </div>`).join('')}
    `;
    panel.querySelector('#notif-clear-all')?.addEventListener('click', () => {
      _notifs.length = 0; _renderNotifPanel();
    });
    panel.querySelectorAll('[data-notif-action]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.notifAction);
        const n = _notifs[idx];
        n?.action?.();
        _notifs.splice(idx, 1);
        panel.classList.remove('open');
        _renderNotifPanel();
      });
    });
    const count = _notifs.length;
    badge.textContent = count;
    badge.style.display = count ? 'flex' : 'none';
    const icon = document.getElementById('notif-icon');
    if (icon) icon.style.filter = count ? '' : 'grayscale(1) opacity(.45)';
  }

  function _pushNotif(title, body, action, actionLabel) {
    if (_notifs.find(n => n.title === title)) return;
    _notifs.push({ title, body, action, actionLabel });
    _renderNotifPanel();
  }

  // public notify for plugins
  function notify(title, body, action, actionLabel) {
    _pushNotif(title, body, action, actionLabel);
  }

  async function _checkOsUpdate() {
    try {
      const res = await fetch('/api/system/check-update');
      if (!res.ok) return;
      const d = await res.json();
      if (!d.up_to_date) {
        _pushNotif(
          'mvmOS update available',
          `${d.commits_behind} new commit${d.commits_behind !== 1 ? 's' : ''} ready (${d.local} → ${d.remote})`,
          () => Settings.openWindow('about'),
          'Open Settings → About'
        );
      }
    } catch (_) {}
  }

  async function _checkUpdates() {
    try {
      const res = await fetch('/api/plugins/manifest');
      if (!res.ok) return;
      const apps = await res.json();
      if (apps.error) return;
      apps.filter(a => a.update_available).forEach(a => {
        _pushNotif(
          `Update available: ${a.icon} ${a.name}`,
          `Version ${a.version} is ready to install.`,
          () => AppStore.openWindow('store-1'),
          'Open App Store'
        );
      });
    } catch (_) {}
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    if (!e.target.closest('.start-submenu') && !e.target.closest('#start-apps-btn')) _closeFlyout();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const btn   = document.getElementById('notif-btn');
    const panel = document.getElementById('notif-panel');
    if (btn && panel) {
      _renderNotifPanel();
      btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('open'); });
      document.addEventListener('click', e => {
        if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-panel')) panel.classList.remove('open');
      });
    }
    setTimeout(() => { _checkUpdates(); setInterval(_checkUpdates, 5 * 60 * 1000); }, 10000);
    setTimeout(() => { _checkOsUpdate(); setInterval(_checkOsUpdate, 30 * 60 * 1000); }, 15000);
    _loadAllWidgets();
    _startResourcePoller();
  });

  // ── Context menu ──────────────────────────────────────────────────────────
  let _ctxMenu = null;

  function _closeCtxMenu() { _ctxMenu?.remove(); _ctxMenu = null; }

  function _showCtxMenu(x, y, app) {
    _closeCtxMenu();
    _ctxMenu = document.createElement('div');
    _ctxMenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,.4)`;
    const onDesktop = window._desktopIsOn?.(app.id) ?? false;
    const items = [
      { label: `▶ Open`, action: () => { _closeFlyout(); document.getElementById('start-menu').classList.remove('open'); fetch(`/api/plugins/${app.id}/open`, { method: 'POST' }).catch(() => {}); app.launch(); } },
      { sep: true },
      onDesktop
        ? { label: `🗑️ Remove from Desktop`, action: () => { window._desktopRemoveApp?.(app.id); } }
        : { label: `➕ Add to Desktop`, action: () => { window._desktopAddApp?.({ id: app.id, label: app.name, emoji: app.icon || '📦', app: app.id, x: 20, y: 20 }); } },
      { sep: true },
      { label: `🗑 Uninstall`, danger: true, action: async () => {
        if (!confirm(`Uninstall "${app.name}"?`)) return;
        await fetch(`/api/plugins/${app.id}`, { method: 'DELETE' });
        _removeFromStartMenu(app.id);
        _closeFlyout();
        document.getElementById('start-menu').classList.remove('open');
      }},
    ];
    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0';
        _ctxMenu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.textContent = item.label;
      el.style.cssText = `padding:6px 14px;cursor:pointer;font-size:.8rem;color:${item.danger ? '#f38ba8' : 'var(--text)'};white-space:nowrap`;
      el.addEventListener('mouseenter', () => el.style.background = 'var(--surface)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', e => { e.stopPropagation(); _closeCtxMenu(); item.action(); });
      _ctxMenu.appendChild(el);
    });
    document.body.appendChild(_ctxMenu);
    // adjust if off-screen
    const r = _ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) _ctxMenu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight - 8) _ctxMenu.style.top = (y - r.height) + 'px';
  }

  document.addEventListener('click', () => _closeCtxMenu());
  document.addEventListener('contextmenu', e => { if (!e.target.closest('.start-submenu-item')) _closeCtxMenu(); });

  // ── App DB helper ─────────────────────────────────────────────────────────
  function _makeDb(appId) {
    return {
      async query(sql, params = []) {
        const res = await fetch(`/api/plugins/${appId}/db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data.rows;
      },
      async run(sql, params = []) {
        const res = await fetch(`/api/plugins/${appId}/db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data.rowcount;
      },
    };
  }

  async function _applyTheme(themeId) {
    await fetch(`/api/themes/${themeId}/activate`, { method: 'POST' });
    const link = document.getElementById('theme-css');
    link.href = `/api/themes/active/css?_=${Date.now()}`;
  }

  return {
    registerApp,
    registerWidget,
    onResources,
    createWindow: (opts) => Desktop.createWindow(opts),
    openSettings: (tab) => Settings.openWindow(tab),
    notify,
    storage,
    db: (appId) => _makeDb(appId),
    _loadPlugin,
    _loadWidget,
    _removeFromStartMenu,
    _removeWidget,
    _loadAllPlugins,
    _setEditMode,
    _applyTheme,
    get _apps() { return _apps; },
    get _widgets() { return _widgets; },
    get _editMode() { return _editMode; },
  };
})();
