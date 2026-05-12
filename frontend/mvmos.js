// mvmOS Plugin API
const mvmOS = (() => {
  const _apps = {};

  // ── Flyout panel (single, two-level) ─────────────────────────────────────

  let _flyout = null;

  function _closeFlyout() {
    _flyout?.remove();
    _flyout = null;
  }

  function _openFlyout(anchorEl) {
    _closeFlyout();

    const rect = anchorEl.getBoundingClientRect();
    _flyout = document.createElement('div');
    _flyout.className = 'start-submenu open';
    _flyout.style.left = rect.right + 4 + 'px';
    _flyout.style.top  = rect.top + 'px';
    document.body.appendChild(_flyout);

    _renderCategories();

    // reposition if overflows bottom
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
        app.launch();
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

  // ── Public API ────────────────────────────────────────────────────────────

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

  async function _loadPlugin(id) {
    try {
      const res = await fetch('/api/plugins');
      const plugins = await res.json();
      const plugin = plugins.find(p => p.id === id);
      if (!plugin) return;
      (new Function(plugin.js_code))();
    } catch (e) { console.error('mvmOS: failed to load plugin', id, e); }
  }

  async function _loadAllPlugins() {
    try {
      const res = await fetch('/api/plugins');
      const plugins = await res.json();
      for (const plugin of plugins) {
        try { (new Function(plugin.js_code))(); }
        catch (e) { console.error('mvmOS: plugin error', plugin.id, e); }
      }
    } catch (e) { console.error('mvmOS: failed to load plugins', e); }
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.start-submenu') && !e.target.closest('#start-apps-btn')) {
      _closeFlyout();
    }
  });

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
          </div>`).join('')
      }
    `;

    panel.querySelector('#notif-clear-all')?.addEventListener('click', () => {
      _notifs.length = 0;
      _renderNotifPanel();
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
    // avoid duplicate notifications for same title
    if (_notifs.find(n => n.title === title)) return;
    _notifs.push({ title, body, action, actionLabel });
    _renderNotifPanel();
  }

  async function _checkOsUpdate() {
    try {
      const res = await fetch('/api/system/check-update');
      if (!res.ok) return;
      const d = await res.json();
      if (!d.up_to_date) {
        _pushNotif(
          `mvmOS update available`,
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
          () => AppStore.openWindow('mvmos'),
          'Open App Store'
        );
      });
    } catch (_) {}
  }

  // wire up bell button
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('notif-btn');
    const panel = document.getElementById('notif-panel');
    if (!btn || !panel) return;

    _renderNotifPanel();

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-panel')) {
        panel.classList.remove('open');
      }
    });

    // check plugin updates after 10s, then every 5 min
    setTimeout(() => {
      _checkUpdates();
      setInterval(_checkUpdates, 5 * 60 * 1000);
    }, 10000);

    // check OS update after 15s, then every 30 min
    setTimeout(() => {
      _checkOsUpdate();
      setInterval(_checkOsUpdate, 30 * 60 * 1000);
    }, 15000);
  });

  return {
    registerApp,
    createWindow: (opts) => Desktop.createWindow(opts),
    openSettings: (tab) => Settings.openWindow(tab),
    _loadPlugin,
    _removeFromStartMenu,
    _loadAllPlugins,
  };
})();
