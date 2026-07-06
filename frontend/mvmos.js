// mvmOS Plugin API
var mvmOS = (() => {
  const _apps = {};

  // Tracks an app open server-side, then refreshes the Start Menu's
  // Recent/Most-used lists so they reflect it immediately (no page reload needed).
  function _trackOpen(id) {
    fetch(`/api/plugins/${id}/open`, { method: 'POST' })
      .then(() => _renderQuickAccess())
      .catch(() => {});
  }

  // Single source of truth for built-in system apps (id, name, icon, launch).
  // Names/icons/categories are also seeded server-side (backend/db.py SYSTEM_APPS)
  // so they participate in Start Menu recent/most-used tracking; this list only
  // needs to add the `launch` binding, which must live in JS.
  function _SYSTEM_APP_DEFS() {
    return [
      { id: 'terminal',         name: t('app_terminal'),  icon: '🖥️', system: true, launch: () => Terminal.openWindow() },
      { id: 'filemanager',      name: t('app_filemanager'), icon: '🗂️', system: true, launch: () => FileManager.openWindow() },
      { id: 'msc',              name: t('app_msc'),       icon: '🛠️', system: true, launch: () => Sites.openWindow() },
      { id: 'appstore',         name: t('app_appstore'),  icon: '📦', system: true, launch: () => AppStore.openWindow() },
      { id: 'startup-manager',  name: t('start_startup'), icon: '🚀', system: true, launch: () => StartupManager.openWindow() },
      { id: 'apphub',           name: t('app_apphub'),    icon: '🧩', system: true, launch: () => AppHub.openWindow() },
      { id: 'settings',         name: t('app_settings'),  icon: '⚙️', system: true, launch: () => Settings.openWindow() },
    ];
  }

  // ── Storage (namespaced localStorage) ────────────────────────────────────
  function _makeStorage(ns) {
    const prefix = `mvmos_app_${ns}_`;
    return {
      get(key)        { try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; } },
      set(key, value) { localStorage.setItem(prefix + key, JSON.stringify(value)); },
      remove(key)     { localStorage.removeItem(prefix + key); },
    };
  }
  // global fallback (shared, avoid using in new apps)
  const storage = _makeStorage('_global');

  // ── Flyout panel (two-level: categories → apps) ───────────────────────────
  let _flyout = null;

  function _closeFlyout() {
    if (_flyout) { _flyout.remove(); _flyout = null; document.getElementById('start-menu').style.visibility = ''; }
    document.querySelector('.start-submenu-inline')?.remove();
  }

  function _openFlyout(anchorEl) {
    _closeFlyout();
    if (window.innerWidth < 768) {
      // on mobile: cover the start menu exactly
      const startMenu = document.getElementById('start-menu');
      const r = startMenu.getBoundingClientRect();
      startMenu.style.visibility = 'hidden';
      _flyout = document.createElement('div');
      _flyout.className = 'start-submenu-inline';
      _flyout.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);display:flex;flex-direction:column;z-index:9600;overflow-y:auto;box-shadow:var(--shadow)`;
      document.body.appendChild(_flyout);
    } else {
      const rect = anchorEl.getBoundingClientRect();
      _flyout = document.createElement('div');
      _flyout.className = 'start-submenu open';
      _flyout.style.left   = rect.right + 4 + 'px';
      _flyout.style.bottom = window.innerHeight - rect.bottom + 'px';
      _flyout.style.maxHeight = rect.bottom - 8 + 'px';
      document.body.appendChild(_flyout);
    }
    _renderCategories();
  }

  function _renderCategories() {
    if (!_flyout) return;
    _flyout.innerHTML = '';
    if (window.innerWidth < 768) {
      const back = document.createElement('div');
      back.className = 'start-submenu-item start-submenu-back';
      back.innerHTML = t('back');
      back.addEventListener('click', e => { e.stopPropagation(); _closeFlyout(); });
      _flyout.appendChild(back);
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:2px 0';
      _flyout.appendChild(sep);
    }
    // System category — always first
    const SYSTEM_APPS = _SYSTEM_APP_DEFS();
    const sysEl = document.createElement('div');
    sysEl.className = 'start-submenu-item';
    sysEl.innerHTML = `<span class="emoji">🖥️</span>${t('start_system')}<span class="start-menu-item-arrow">›</span>`;
    sysEl.addEventListener('click', e => { e.stopPropagation(); _renderApps(SYSTEM_APPS, 'System'); });
    _flyout.appendChild(sysEl);

    const cats = {};
    Object.values(_apps).filter(app => !app.system).forEach(app => {
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
        _trackOpen(app.id);
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

  // ── Start menu quick access ───────────────────────────────────────────────
  let _quickAccessEl = null;

  async function _renderQuickAccess() {
    const startMenu = document.getElementById('start-menu');
    if (!startMenu) return;
    const prefs = (await Settings.loadStartMenuPrefs?.()) || Settings.defaultStartMenuPrefs?.() || { order: ['recent','frequent','custom'], recent: 0, frequent: 0, custom: [] };
    Settings.applyStartMenuOpacity?.(prefs.opacity ?? 80);

    // fetch recent/frequent from API if needed
    let recentApps = [], frequentApps = [];
    const needsApi = (prefs.recent > 0 || prefs.frequent > 0);
    if (needsApi) {
      try {
        const res = await fetch('/api/plugins');
        const data = await res.json();
        const plugins = (data.plugins || data || []).filter(p => _apps[p.id]);
        recentApps = [...plugins].filter(p => p.last_opened_at).sort((a, b) => b.last_opened_at - a.last_opened_at).slice(0, prefs.recent);
        frequentApps = [...plugins].sort((a, b) => (b.open_count || 0) - (a.open_count || 0)).slice(0, prefs.frequent);
      } catch (_) {}
    }

    // build items per block
    function _blockItems(blockId) {
      if (blockId === 'recent') return recentApps;
      if (blockId === 'frequent') return frequentApps;
      return prefs.custom.map(id => _apps[id]).filter(Boolean);
    }

    // check if anything to show
    const hasAny = prefs.order.some(b => _blockItems(b).length > 0);

    // remove old
    _quickAccessEl?.remove();
    _quickAccessEl = null;

    if (!hasAny) return;

    _quickAccessEl = document.createElement('div');
    _quickAccessEl.id = 'start-quick-access';

    const BLOCK_LABELS = { recent: t('start_recent'), frequent: t('start_frequent'), custom: t('start_quick_access') };
    const _seen = new Set();

    prefs.order.forEach(blockId => {
      let items = _blockItems(blockId);
      if (prefs[blockId + '_dedup']) items = items.filter(a => !_seen.has(a.id));
      items.forEach(a => _seen.add(a.id));
      if (!items.length) return;
      const block = document.createElement('div');
      block.style.cssText = 'margin-bottom:2px';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:.67rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.07em;padding:6px 14px 2px';
      label.textContent = BLOCK_LABELS[blockId];
      block.appendChild(label);
      items.forEach(app => {
        const el = document.createElement('div');
        el.className = 'start-menu-item';
        el.innerHTML = `<span class="emoji">${app.icon || '📦'}</span>${app.name}`;
        el.addEventListener('click', () => {
          startMenu.classList.remove('open');
          _closeFlyout();
          const appDef = _apps[app.id];
          if (appDef) { _trackOpen(app.id); appDef.launch(); }
        });
        block.appendChild(el);
      });
      _quickAccessEl.appendChild(block);
    });

    // insert before Applications button (which sits before anchor)
    const appsBtn = startMenu.querySelector('#start-apps-btn');
    const anchor = startMenu.querySelector('#start-menu-apps-anchor');
    const ref = appsBtn || anchor;
    ref.parentNode.insertBefore(_quickAccessEl, ref);

    // separator between quick access and Applications
    if (!startMenu.querySelector('#start-quick-sep')) {
      const sep = document.createElement('div');
      sep.className = 'start-menu-sep';
      sep.id = 'start-quick-sep';
      ref.parentNode.insertBefore(sep, ref);
    }
  }

  window.addEventListener('startmenu-changed', () => _renderQuickAccess());

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
    _appsMenuItem.innerHTML = `<span class="emoji">⚡</span> ${t('start_applications')} <span class="start-menu-item-arrow">›</span>`;
    const anchor = startMenu.querySelector('#start-menu-apps-anchor');
    anchor.parentNode.insertBefore(sep, anchor);
    anchor.parentNode.insertBefore(_appsMenuItem, anchor);
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
    def.storage = _makeStorage(def.id);
    if (def.requires_apphub) {
      const _launch = def.launch;
      def.launch = (...args) => {
        if (typeof AppHub !== 'undefined') AppHub.requireLogin(() => _launch(...args));
        else _launch(...args);
      };
    }
    _apps[def.id] = def;
    _ensureAppsMenuItem();
  }

  function _removeFromStartMenu(id) {
    delete _apps[id];
    _closeFlyout();
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
      const right = document.getElementById('taskbar-right');
      if (notifBtn) notifBtn.parentNode.insertBefore(el, notifBtn);
      else if (right) right.prepend(el);
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
    _attachWidgetContextMenu(wrap, def);
    if (window.innerWidth < 768) _updateMobileTaskbarWidgets();
  }

  function _updateMobileTaskbarWidgets() {
    if (window.innerWidth >= 768) return;
    const bar = document.getElementById('taskbar-widgets');
    if (!bar) return;
    // hide all widgets — they show in clock popup on mobile
    bar.querySelectorAll('[data-widget-id]').forEach(w => { w.style.display = 'none'; });
  }

  function _toggleMobileWidgetPopup(bar, wraps) {
    let popup = document.getElementById('mobile-widget-popup');
    if (popup) {
      wraps.forEach(w => { w.style.display = 'none'; bar.appendChild(w); });
      popup.remove();
      return;
    }
    popup = document.createElement('div');
    popup.id = 'mobile-widget-popup';
    popup.style.cssText = 'position:fixed;bottom:52px;right:4px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;display:flex;flex-direction:column;gap:0;z-index:10000;min-width:200px;max-width:90vw;box-shadow:0 -4px 16px rgba(0,0,0,.4)';
    wraps.forEach(w => {
      w.style.display = 'flex';
      w.style.padding = '6px 0';
      w.style.borderBottom = '1px solid var(--border)';
      w.style.minHeight = '40px';
      popup.appendChild(w);
    });
    document.body.appendChild(popup);
    setTimeout(() => document.addEventListener('click', e => {
      if (!popup.contains(e.target)) {
        wraps.forEach(w => { w.style.display = 'none'; bar.appendChild(w); });
        popup.remove();
      }
    }, { once: true }), 50);
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

  const WIDGET_SIZES = { s: 's', m: 'm', l: 'l' };
  const WIDGET_SIZE_WIDTHS = { s: 180, m: 240, l: 340 };

  function _getWidgetSize(id, def) {
    return def._savedSize || localStorage.getItem(`widget-size-${id}`) || def.defaultSize || 'm';
  }
  function _setWidgetSize(id, size) {
    localStorage.setItem(`widget-size-${id}`, size);
    // update cached value on def so _getWidgetSize returns it immediately
    const def = _widgets[id];
    if (def) def._savedSize = size;
    fetch(`/api/widgets/${id}/size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size }),
    }).catch(() => {});
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
      if (saved?.size) def._savedSize = saved.size;
    } catch(_) {}

    const wrap = document.createElement('div');
    wrap.dataset.desktopWidget = def.id;
    wrap.style.cssText = `position:absolute;left:${x}px;top:${y}px;z-index:10;user-select:none;border-radius:var(--radius);overflow:visible;`;
    desktop.appendChild(wrap);

    // hover titlebar
    const titlebar = document.createElement('div');
    titlebar.className = 'widget-titlebar';
    titlebar.innerHTML = `<span class="widget-title">${def.icon || ''} ${def.name || def.id}</span><button class="widget-close-btn window-btn close">✕</button>`;
    wrap.appendChild(titlebar);

    // body for widget content
    const body = document.createElement('div');
    body.className = 'widget-body';
    wrap.appendChild(body);

    // init with size if widget supports it
    const sizes = def.sizes;
    function _applySize(size) {
      if (!sizes) return;
      body.innerHTML = '';
      def.init(body, size);
    }
    if (sizes) {
      const sz = _getWidgetSize(def.id, def);
      _applySize(sz);
    } else {
      def.init(body);
    }

    _attachWidgetContextMenu(wrap, def, sizes ? () => {
      const sz = _getWidgetSize(def.id, def);
      _applySize(sz);
    } : null);

    // close button
    titlebar.querySelector('.widget-close-btn').addEventListener('click', e => {
      e.stopPropagation();
      fetch(`/api/widgets/${def.id}/position`, { method: 'DELETE' }).catch(() => {});
      fetch(`/api/widgets/${def.id}`, { method: 'DELETE' }).catch(() => {});
      wrap.remove();
      _removeWidget(def.id);
    });

    // drag to move — only from titlebar
    let dragging = false, ox = 0, oy = 0, saveTimer = null;
    titlebar.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
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

    let _resourceInterval = null;
  function _startResourcePoller() {
    _pollResources();
    const sec = Math.max(1, parseInt(window._vosSettings?.widget_refresh) || 3);
    _resourceInterval = setInterval(_pollResources, sec * 1000);
  }

  window.addEventListener('settings-changed', async e => {
    const sec = Math.max(1, parseInt(e.detail?.widget_refresh) || 3);
    if (_resourceInterval) { clearInterval(_resourceInterval); _resourceInterval = setInterval(_pollResources, sec * 1000); }
    // update closeToTray for open trayable windows
    const appId = e.detail?.app;
    if (appId && _apps[appId]?.trayable) {
      try {
        const db = mvmOS.db(appId);
        const rows = await db.query("SELECT value FROM cfg WHERE key='close_to_tray'");
        const val = rows.length ? JSON.parse(rows[0].value) : false;
        Desktop.setWindowCloseToTray(appId, val);
      } catch (_) {}
    }
  });

  function onResources(fn) {
    _resourceListeners.push(fn);
    if (_lastResources) fn(_lastResources);
  }

  function _removeWidget(id) {
    delete _widgets[id];
    document.querySelector(`[data-widget-id="${id}"]`)?.remove();
    document.querySelector(`[data-desktop-widget="${id}"]`)?.remove();
  }

  function widgetSetting(id, key, defaultVal = null) {
    const stored = storage.get(`widget_${id}_${key}`);
    return stored !== null ? stored : defaultVal;
  }

  function _showWidgetContextMenu(e, def, onSizeChange) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelector('.widget-ctx-menu')?.remove();

    const t = k => (window._i18n?.[k] || k);
    const menu = document.createElement('div');
    menu.className = 'widget-ctx-menu ctx-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999`;

    const items = [];
    // Settings — only if widget has settings defined
    if (def.settings?.length) {
      items.push({ label: t('wstore_ctx_settings'), action: () => {
        AppStore.openWindow({ section: 'my-widgets', widgetId: def.id });
      }});
    }
    // Size submenu — only if widget declares sizes
    if (def.sizes?.length && onSizeChange) {
      const SIZE_LABELS = { s: `S — ${WIDGET_SIZE_WIDTHS.s}px`, m: `M — ${WIDGET_SIZE_WIDTHS.m}px`, l: `L — ${WIDGET_SIZE_WIDTHS.l}px` };
      def.sizes.forEach(sz => {
        const cur = _getWidgetSize(def.id, def);
        items.push({ label: (cur === sz ? '✓ ' : '   ') + SIZE_LABELS[sz], action: () => {
          _setWidgetSize(def.id, sz);
          onSizeChange();
        }});
      });
    }
    // Custom developer items
    if (Array.isArray(def.contextMenu)) {
      if (items.length && def.contextMenu.length) items.push(null); // separator
      def.contextMenu.forEach(item => items.push(item));
    }
    // Remove
    if (items.length) items.push(null);
    items.push({ label: t('wstore_ctx_remove'), action: () => {
      fetch(`/api/widgets/${def.id}/position`, { method: 'DELETE' }).catch(() => {});
      _removeWidget(def.id);
      fetch(`/api/widgets/${def.id}`, { method: 'DELETE' }).catch(() => {});
    }});

    items.forEach(item => {
      if (!item) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
      } else {
        const btn = document.createElement('div');
        btn.className = 'ctx-item';
        btn.textContent = item.label;
        btn.addEventListener('click', () => { menu.remove(); item.action(); });
        menu.appendChild(btn);
      }
    });

    document.body.appendChild(menu);

    // reposition if off-screen
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';

    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
  }

  function _attachWidgetContextMenu(wrap, def, onSizeChange) {
    wrap.addEventListener('contextmenu', e => _showWidgetContextMenu(e, def, onSizeChange));

    // long press for touch devices
    if (navigator.maxTouchPoints > 0) {
      let _lpTimer = null, _lpFired = false;
      wrap.addEventListener('touchstart', e => {
        _lpFired = false;
        _lpTimer = setTimeout(() => {
          _lpFired = true;
          _showWidgetContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }, def, onSizeChange);
        }, 500);
      }, { passive: true });
      wrap.addEventListener('touchend', () => clearTimeout(_lpTimer));
      wrap.addEventListener('touchmove', () => clearTimeout(_lpTimer));
    }
  }

  async function _loadWidget(id) {
    try {
      const base = `/widgets/${id}`;
      let entry = 'main.js', css = null;
      try {
        const mf = await fetch(`${base}/manifest.json?_=${Date.now()}`);
        if (mf.ok) { const j = await mf.json(); entry = j.entry || 'main.js'; css = j.css || null; }
      } catch (_) {}
      if (css && !document.getElementById(`widget-css-${id}`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.id = `widget-css-${id}`;
        link.href = `${base}/${css}?_=${Date.now()}`;
        document.head.appendChild(link);
      }
      const res = await fetch(`${base}/${entry}?_=${Date.now()}`);
      if (!res.ok) {
        _pushNotif(`Widget needs reinstall: ${id}`, t('wstore_no_installed'), null, null);
        return;
      }
      const code = await res.text();
      await (window.mvmOS?.i18nReady || Promise.resolve());
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
    if (_projectNoApp.has(id)) return;
    try {
      const base = `/apps/${id}`;
      let entry = 'main.js';
      let css = null;
      try {
        const mf = await fetch(`${base}/manifest.json?_=${Date.now()}`);
        if (mf.ok) { const j = await mf.json(); entry = j.entry || 'main.js'; css = j.css || null; }
      } catch (_) {}
      const res = await fetch(`${base}/${entry}?_=${Date.now()}`);
      if (!res.ok) {
        if (_projectIds.has(id)) return;
        _pushNotif(
          `App needs reinstall: ${id}`,
          'The app files are missing. Please reinstall it from the App Store.',
          () => AppStore.openWindow('store-1'),
          'Open App Store'
        );
        return;
      }
      if (css && !document.getElementById(`app-css-${id}`)) {
        const link = document.createElement('link');
        link.id = `app-css-${id}`;
        link.rel = 'stylesheet';
        link.href = `${base}/${css}?_=${Date.now()}`;
        document.head.appendChild(link);
      }
      const code = await res.text();
      await (window.mvmOS?.i18nReady || Promise.resolve());
      (new Function(code))();
    } catch (e) { console.error('mvmOS: failed to load plugin', id, e); }
  }

  let _projectIds = new Set();
  let _projectNoApp = new Set();

  async function _loadAllPlugins() {
    try {
      const pres = await fetch('/api/projects');
      if (pres.ok) {
        const ps = await pres.json();
        _projectIds = new Set(ps.map(p => p.id));
        _projectNoApp = new Set(ps.filter(p => !p.has_app).map(p => p.id));
      }
    } catch (_) {}
    try {
      const res = await fetch('/api/plugins');
      const plugins = await res.json();
      for (const plugin of plugins) {
        await _loadPlugin(plugin.id);
      }
      // re-render desktop icons now that all apps are registered
      document.dispatchEvent(new CustomEvent('mvmos-plugins-loaded'));
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
        ${t('notif_title')}
        <span class="notif-clear" id="notif-clear-all">${t('notif_clear_all')}</span>
      </div>
      ${_notifs.length === 0
        ? `<div class="notif-empty">${t('notif_empty')}</div>`
        : _notifs.map((n, i) => `
          <div class="notif-item">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-body">${n.body}</div>
            ${n.action ? `<span class="notif-item-action" data-notif-action="${i}">${n.actionLabel || t('notif_open')}</span>` : ''}
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
    const baseTitle = window._effectiveUser && window._hostname
      ? `mvmOS — ${window._effectiveUser}@${window._hostname}`
      : 'mvmOS';
    document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
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
          t('os_update_body', { behind: d.commits_behind, s: d.commits_behind !== 1 ? 's' : '', local: d.local, remote: d.remote }),
          () => Settings.openWindow('about'),
          t('os_update_open')
        );
      }
    } catch (_) {}
  }

  async function _checkUpdates() {
    try {
      const res = await fetch('/api/updates');
      if (!res.ok) return;
      const updates = await res.json();
      if (!updates.length) return;
      const count = updates.length;
      _pushNotif(
        t('updates_available', { n: count, s: count !== 1 ? 's' : '' }),
        t('updates_body'),
        () => UpdateManager.openWindow(),
        t('updates_open')
      );
    } catch (_) {}
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    if (!e.target.closest('.start-submenu') && !e.target.closest('#start-apps-btn')) _closeFlyout();
  });

  function _init() {
    // register built-in apps so desktop icons can find their icons
    _SYSTEM_APP_DEFS().forEach(def => { _apps[def.id] = def; });

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
    _ensureAppsMenuItem();
    _loadAllWidgets().then(() => _splashProgress(80));
    _startResourcePoller();
    Wallpaper.apply();
    document.addEventListener('mvmos-plugins-loaded', () => {
      _renderQuickAccess();
      _splashProgress(100);
      setTimeout(_splashHide, 300);
    });
  }

  function _splashProgress(pct) {
    const bar = document.getElementById('splash-progress');
    if (bar) bar.style.width = pct + '%';
  }
  function _splashHide() {
    const el = document.getElementById('splash');
    if (!el) return;
    el.classList.add('hide');
    document.body.classList.remove('splashing');
    setTimeout(() => el.remove(), 450);
  }

  document.addEventListener('DOMContentLoaded', () => {
    _splashProgress(20);
    const run = () => { _splashProgress(60); _init(); };
    if (window._i18n) { run(); return; }
    window.addEventListener('i18n-loaded', run, { once: true });
    setTimeout(() => { if (!window._i18n) run(); }, 1000);
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
      { label: `▶ Open`, action: () => { _closeFlyout(); document.getElementById('start-menu').classList.remove('open'); _trackOpen(app.id); app.launch(); } },
      { sep: true },
      onDesktop
        ? { label: `🗑️ Remove from Desktop`, action: () => { window._desktopRemoveApp?.(app.id); } }
        : { label: `➕ Add to Desktop`, action: () => { window._desktopAddApp?.({ id: app.id, label: app.name, emoji: app.icon || '📦', app: app.id, x: 20, y: 20 }); } },
    ];
    if (!app.system) {
      items.push(
        { sep: true },
        { label: `🗑 Uninstall`, danger: true, action: async () => {
          if (!confirm(`Uninstall "${app.name}"?`)) return;
          await fetch(`/api/plugins/${app.id}`, { method: 'DELETE' });
          _removeFromStartMenu(app.id);
          _closeFlyout();
          document.getElementById('start-menu').classList.remove('open');
        }},
      );
    }
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
  function _makeWidgetDb(widgetId) {
    return {
      async query(sql, params = []) {
        const res = await fetch(`/api/widgets/${widgetId}/db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data.rows;
      },
      async run(sql, params = []) {
        const res = await fetch(`/api/widgets/${widgetId}/db`, {
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

  // ── mvmOS SDK ─────────────────────────────────────────────────────────────
  const _sdk = {
    system: {
      // Current CPU, memory, disk usage + hardware info
      async resources() {
        const [rRes, hRes] = await Promise.all([
          fetch('/api/system/resources'),
          fetch('/api/system/hardware'),
        ]);
        return { ...(await rRes.json()), ...(await hRes.json()) };
      },
      // List running processes
      async processes() {
        const r = await fetch('/api/system/processes');
        return r.json();
      },
      // Kill a process by PID. signal: 'SIGTERM' | 'SIGKILL'
      async kill(pid, signal = 'SIGTERM', sudo_password = '') {
        const r = await fetch('/api/system/processes/kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid, signal, sudo_password }),
        });
        return r.json();
      },
      // List systemd services
      async services() {
        const r = await fetch('/api/system/services');
        return r.json();
      },
      // Control a systemd service. action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'
      async serviceAction(name, action, sudo_password = '') {
        const r = await fetch('/api/system/services/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, action, sudo_password }),
        });
        return r.json();
      },
    },
    fs: {
      // List directory contents. Returns array of file/folder entries.
      async list(path) {
        const r = await fetch('/api/files/list?path=' + encodeURIComponent(path));
        return r.json();
      },
      // Read a text file
      async read(path) {
        const r = await fetch('/api/files/read?path=' + encodeURIComponent(path));
        return r.json();
      },
      // Write a text file
      async write(path, content) {
        const r = await fetch('/api/files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        });
        return r.json();
      },
      // Delete a file or folder
      async delete(path) {
        const r = await fetch('/api/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        return r.json();
      },
      // Create a folder
      async mkdir(path) {
        const r = await fetch('/api/files/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        return r.json();
      },
      // Rename/move a file or folder
      async rename(from, to) {
        const r = await fetch('/api/files/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to }),
        });
        return r.json();
      },
    },
  };

  const _api = {
    registerApp,
    registerWidget,
    onResources,
    system: _sdk.system,
    fs: _sdk.fs,
    createWindow: async (opts) => {
      let closeToTray = opts.closeToTray || false;
      const appDef = opts.id ? _apps[opts.id] : null;
      if (appDef?.trayable && !closeToTray) {
        try {
          const db = mvmOS.db(opts.id);
          const rows = await db.query("SELECT value FROM cfg WHERE key='close_to_tray'");
          if (rows.length) closeToTray = JSON.parse(rows[0].value);
        } catch (_) {}
      }
      return Desktop.createWindow({ ...opts, closeToTray });
    },
    initMobileSidebar: (body) => Desktop.initMobileSidebar(body),
    openSettings: (tab) => Settings.openWindow(tab),
    openApp: (id) => { const a = _apps[id]; if (a) { _trackOpen(id); a.launch(); } },
    notify,
    storage,
    multiplayer: {
      async createRoom(gameId, opts = {}) {
        const res = await fetch('/api/multiplayer/room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game_id: gameId, ...opts }),
        });
        const data = await res.json();
        const origin = location.origin;
        return {
          roomId: data.room_id,
          link: `${origin}/api/multiplayer/play/${gameId}/${data.room_id}`,
        };
      },
      connect(roomId, gameId) {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/api/multiplayer/room/${roomId}/ws`);
        return ws;
      },
    },
    widgetSetting,
    db: (appId) => _makeDb(appId),
    widgetDb: (widgetId) => _makeWidgetDb(widgetId),
    requireRoot(title, message) {
      const _t = k => window._i18n?.[k] || window.mvmOS?.t?.(k) || k;
      return new Promise(async resolve => {
        const sudoRes = await fetch('/api/auth/can-sudo').then(r => r.json()).catch(() => ({ ok: false }));
        if (sudoRes.is_root) { resolve(true); return; }
        if (!sudoRes.ok) {
          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
          ov.innerHTML = `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow)">
              <div style="font-size:1.05rem;font-weight:700;margin-bottom:8px">🔐 ${title || _t('require_root_title') || 'Confirmation required'}</div>
              <div style="font-size:.85rem;color:#f38ba8;margin-bottom:16px">${_t('require_root_no_sudo') || 'Your account does not have the necessary privileges to perform this action.'}</div>
              <div style="display:flex;justify-content:flex-end">
                <button id="_rr-close" class="s-btn s-btn-sm">${_t('close') || 'Close'}</button>
              </div>
            </div>`;
          document.body.appendChild(ov);
          ov.querySelector('#_rr-close').onclick = () => { ov.remove(); resolve(false); };
          return;
        }
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
        ov.innerHTML = `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow)">
            <div style="font-size:1.05rem;font-weight:700;margin-bottom:8px">🔐 ${title || _t('require_root_title') || 'Root required'}</div>
            ${message ? `<div style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px">${message}</div>` : ''}
            <label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">${_t('require_root_password') || 'Your password'}</label>
            <input type="password" id="_rr-pw" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:.85rem;margin-bottom:6px" placeholder="${_t('require_root_ph') || 'Enter your password…'}">
            <div id="_rr-err" style="font-size:.78rem;color:#f38ba8;min-height:16px;margin-bottom:12px"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="_rr-cancel" class="s-btn s-btn-sm">${_t('cancel') || 'Cancel'}</button>
              <button id="_rr-ok" class="s-btn s-btn-sm s-btn-primary">${_t('confirm') || 'Confirm'}</button>
            </div>
          </div>`;
        document.body.appendChild(ov);
        const pw = ov.querySelector('#_rr-pw');
        const err = ov.querySelector('#_rr-err');
        const okBtn = ov.querySelector('#_rr-ok');
        pw.focus();
        ov.querySelector('#_rr-cancel').onclick = () => { ov.remove(); resolve(false); };
        const confirm = async () => {
          if (!pw.value) { err.textContent = _t('require_root_required') || 'Password required'; return; }
          okBtn.disabled = true; okBtn.textContent = '…';
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw.value }),
          });
          if (res.ok) { ov.remove(); resolve(true); }
          else {
            const msg = await res.json().catch(() => ({}));
            err.textContent = res.status === 429 ? (msg.detail || 'Too many attempts.') : (_t('require_root_wrong') || 'Wrong password');
            okBtn.disabled = res.status === 429;
            if (res.status !== 429) { okBtn.textContent = _t('confirm') || 'Confirm'; pw.value = ''; pw.focus(); }
          }
        };
        okBtn.onclick = confirm;
        pw.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
      });
    },
    confirm(message, opts) {
      opts = opts || {};
      const _t = k => window._i18n?.[k] || window.mvmOS?.t?.(k) || k;
      return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
        ov.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px">
          <div style="font-size:.92rem;line-height:1.5">${message}</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_mc-cancel" class="s-btn s-btn-sm">${opts.cancel || _t('cancel') || 'Cancel'}</button>
            <button id="_mc-ok" class="s-btn s-btn-sm" style="${opts.danger !== false ? 'background:#f38ba8;color:#1e1e2e;border-color:#f38ba8' : 'background:var(--accent);color:#fff;border-color:var(--accent)'}">${opts.ok || _t('confirm') || 'Confirm'}</button>
          </div></div>`;
        document.body.appendChild(ov);
        ov.querySelector('#_mc-cancel').onclick = () => { ov.remove(); resolve(false); };
        ov.querySelector('#_mc-ok').onclick = () => { ov.remove(); resolve(true); };
      });
    },
    prompt(message, placeholder, defaultValue) {
      const _t = k => window._i18n?.[k] || window.mvmOS?.t?.(k) || k;
      return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
        ov.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px">
          <div style="font-size:.92rem">${message}</div>
          <input id="_mp-input" class="s-input" placeholder="${placeholder || ''}" value="${defaultValue || ''}" style="width:100%;box-sizing:border-box">
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_mp-cancel" class="s-btn s-btn-sm">${_t('cancel') || 'Cancel'}</button>
            <button id="_mp-ok" class="s-btn s-btn-sm s-btn-primary">${_t('ok') || 'OK'}</button>
          </div></div>`;
        document.body.appendChild(ov);
        const input = ov.querySelector('#_mp-input');
        input.focus(); input.select();
        const ok = () => { const v = input.value; ov.remove(); resolve(v || null); };
        ov.querySelector('#_mp-cancel').onclick = () => { ov.remove(); resolve(null); };
        ov.querySelector('#_mp-ok').onclick = ok;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { ov.remove(); resolve(null); } });
      });
    },
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

  // i18n.js runs before this file and attaches onLangChange/i18nReady/lang/t
  // to window.mvmOS = {}. Copy them over so they survive the reassignment.
  if (window.mvmOS) {
    if (window.mvmOS.onLangChange) _api.onLangChange = window.mvmOS.onLangChange;
    if (window.mvmOS.i18nReady)    _api.i18nReady    = window.mvmOS.i18nReady;
    if (window.mvmOS.lang)         _api.lang         = window.mvmOS.lang;
  }

  return _api;
})();
