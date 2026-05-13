// ── Window manager & desktop shell ──────────────────────────────────────────

const Desktop = (() => {
  let zCounter = 100;
  let windows = {};     // id → { el, title, minimized }
  let desktopState = { icons: {}, nextId: 1 };

  const desktop = document.getElementById('desktop');
  const taskbarWindows = document.getElementById('taskbar-windows');

  // ── Desktop state persistence ──
  async function loadState() {
    try {
      const res = await fetch('/api/desktop');
      if (!res.ok) return;
      const data = await res.json();
      desktopState = { icons: {}, nextId: 1, ...data };
    } catch (_) {}
  }

  async function saveState() {
    try {
      await fetch('/api/desktop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: desktopState }),
      });
    } catch (_) {}
  }

  // ── Clock ──
  function startClock() {
    const clock = document.getElementById('clock');

    function formatDate(now, fmt) {
      const d = String(now.getDate()).padStart(2, '0');
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const y = now.getFullYear();
      if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
      if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
      return `${d}/${m}/${y}`;
    }

    function tick() {
      const now = new Date();
      const s = window._vosSettings || {};
      const hour12 = s.time_format === '12';
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });
      if (s.show_date) {
        clock.textContent = `${formatDate(now, s.date_format || 'DD/MM/YYYY')}  ${timeStr}`;
      } else {
        clock.textContent = timeStr;
      }
    }

    tick();
    setInterval(tick, 10000);
    window.addEventListener('settings-changed', e => { window._vosSettings = e.detail; tick(); });

    // ── Calendar popup ──
    let calPopup = null;

    function openCalendar() {
      if (calPopup) { calPopup.remove(); calPopup = null; return; }
      const s = window._vosSettings || {};
      const sundayFirst = s.week_starts === 'sunday';
      const now = new Date();
      let viewYear = now.getFullYear();
      let viewMonth = now.getMonth();

      calPopup = document.createElement('div');
      calPopup.id = 'cal-popup';
      document.body.appendChild(calPopup);

      function renderCal() {
        const today = new Date();
        const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const DAY_LABELS_MON = ['Mo','Tu','We','Th','Fr','Sa','Su'];
        const DAY_LABELS_SUN = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        const dayLabels = sundayFirst ? DAY_LABELS_SUN : DAY_LABELS_MON;

        // offset: how many empty cells before day 1
        let offset = sundayFirst ? firstDay : (firstDay === 0 ? 6 : firstDay - 1);

        let cells = '';
        for (let i = 0; i < offset; i++) cells += '<span></span>';
        for (let d = 1; d <= daysInMonth; d++) {
          const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
          cells += `<span class="cal-day${isToday ? ' cal-today' : ''}">${d}</span>`;
        }

        calPopup.innerHTML = `
          <div class="cal-header">
            <button class="cal-nav" id="cal-prev">‹</button>
            <span class="cal-title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
            <button class="cal-nav" id="cal-next">›</button>
          </div>
          <div class="cal-grid">
            ${dayLabels.map(l => `<span class="cal-dow">${l}</span>`).join('')}
            ${cells}
          </div>
        `;

        calPopup.querySelector('#cal-prev').addEventListener('click', e => {
          e.stopPropagation();
          viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
          renderCal();
        });
        calPopup.querySelector('#cal-next').addEventListener('click', e => {
          e.stopPropagation();
          viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
          renderCal();
        });
      }

      renderCal();

      // position above clock
      const rect = clock.getBoundingClientRect();
      calPopup.style.right = (window.innerWidth - rect.right) + 'px';
      calPopup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';

      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!calPopup?.contains(e.target) && e.target !== clock) {
            calPopup?.remove(); calPopup = null;
            document.removeEventListener('click', handler);
          }
        });
      }, 0);
    }

    clock.style.cursor = 'pointer';
    clock.addEventListener('click', e => { e.stopPropagation(); openCalendar(); });
  }

  // ── Default icons ──
  const BUILTIN_ICONS = [
    { id: 'terminal', label: 'Terminal', emoji: '🖥️', app: 'terminal' },
    { id: 'files',    label: 'Files',    emoji: '📁', app: 'filemanager' },
    { id: 'settings', label: 'Settings', emoji: '⚙️', app: 'settings' },
  ];

  // container for grid icons
  const iconsContainer = document.createElement('div');
  iconsContainer.id = 'desktop-icons';
  desktop.appendChild(iconsContainer);

  let _desktopEntries = []; // from ~/Desktop filesystem

  function _watchDesktop() {
    const es = new EventSource('/api/files/desktop/watch');
    es.onmessage = async e => {
      if (e.data === 'changed') {
        await loadDesktopFiles();
        renderIcons();
      }
    };
    es.onerror = () => { es.close(); setTimeout(_watchDesktop, 5000); };
  }

  async function loadDesktopFiles() {
    try {
      const res = await fetch('/api/files/desktop/list');
      if (!res.ok) return;
      const data = await res.json();
      _desktopEntries = data.entries || [];
    } catch (_) { _desktopEntries = []; }
  }

  function _fileIcon(entry) {
    if (entry.type === 'dir')  return { emoji: '📁' };
    if (entry.type === 'url')  return { favicon: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(entry.url || '')}` };
    if (entry.type === 'app')  {
      const appDef = window.mvmOS?._apps?.[entry.app_id];
      return { emoji: appDef?.icon || '📦' };
    }
    const img = ['jpg','jpeg','png','gif','webp','bmp','svg'];
    const vid = ['mp4','webm','ogg','mov','mkv'];
    const aud = ['mp3','flac','wav','aac','opus','m4a'];
    const ext = entry.ext || '';
    if (img.includes(ext)) return { emoji: '🖼️' };
    if (vid.includes(ext)) return { emoji: '🎬' };
    if (aud.includes(ext)) return { emoji: '🎵' };
    return { emoji: '📄' };
  }

  function renderIcons() {
    iconsContainer.innerHTML = '';
    const positions = desktopState.positions || {};

    const toRender = [];

    // built-in app icons
    BUILTIN_ICONS.forEach((def, i) => {
      if (desktopState.hidden?.[def.id]) return;
      toRender.push({ ...def, order: positions[def.id]?.order ?? i });
    });

    // mvmOS plugin apps
    if (window.mvmOS) {
      Object.values(mvmOS._apps).forEach(a => {
        if (desktopState.hidden?.['app-' + a.id]) return;
        toRender.push({ id: 'app-' + a.id, label: a.name, emoji: a.icon || '📦', app: a.id, order: positions['app-' + a.id]?.order ?? 9999 });
      });
    }

    // filesystem desktop entries
    _desktopEntries.forEach((entry, i) => {
      const icon = _fileIcon(entry);
      const appLabel = entry.type === 'app' && window.mvmOS?._apps?.[entry.app_id]?.name;
      const label = appLabel || entry.name.replace(/\.(url|mvmos)$/, '');
      toRender.push({ id: 'fs-' + entry.name, label, ...icon, fsEntry: entry, order: positions['fs-' + entry.name]?.order ?? 1000 + i });
    });

    toRender.sort((a, b) => a.order - b.order);
    toRender.forEach(def => createIcon(def));
  }

  // icon context menu
  const iconCtxMenu = document.createElement('div');
  iconCtxMenu.id = 'icon-ctx-menu';
  iconCtxMenu.className = 'ctx-item-wrap';
  iconCtxMenu.style.cssText = 'position:fixed;display:none;flex-direction:column;min-width:160px;z-index:99999';
  document.body.appendChild(iconCtxMenu);

  function showIconCtx(x, y, items) {
    iconCtxMenu.innerHTML = items.map(it =>
      it === 'sep'
        ? `<div class="ctx-sep"></div>`
        : `<div class="ctx-item${it.danger ? ' ctx-danger' : ''}" data-action="${it.action}">${it.label}</div>`
    ).join('');
    iconCtxMenu.style.cssText = `position:fixed;display:flex;flex-direction:column;min-width:160px;z-index:99999;
      left:${Math.min(x, window.innerWidth-170)}px;top:${Math.min(y, window.innerHeight-120)}px;
      background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
      box-shadow:var(--shadow);overflow:hidden`;
    return iconCtxMenu;
  }

  function hideIconCtx() { iconCtxMenu.style.display = 'none'; }

  function removeFromDesktop(id) {
    if (!desktopState.hidden) desktopState.hidden = {};
    desktopState.hidden[id] = true;
    saveState();
    renderIcons();
  }

  function addToDesktop(def) {
    if (!desktopState.hidden) desktopState.hidden = {};
    delete desktopState.hidden[def.id];
    saveState();
    renderIcons();
  }

  function allIconDefs() { return BUILTIN_ICONS; }

  function isOnDesktop(id) {
    return !desktopState.hidden?.[id];
  }

  window._desktopAddApp = async (appDef) => {
    await fetch('/api/files/desktop/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appDef.id, label: appDef.label }),
    });
    await loadDesktopFiles();
    renderIcons();
  };
  window._desktopRemoveApp = async (id) => {
    const entry = _desktopEntries.find(e => e.type === 'app' && e.app_id === id);
    if (entry) {
      await fetch(`/api/files/desktop/entry?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      await loadDesktopFiles();
      renderIcons();
    }
  };
  window._desktopIsOn = (id) => {
    return _desktopEntries.some(e => e.type === 'app' && e.app_id === id);
  };

  function createIcon({ id, label, emoji, app, favicon, url, fsEntry }) {
    const el = document.createElement('div');
    el.className = 'icon';
    el.dataset.id = id;
    el.dataset.app = app || '';
    const iconHtml = favicon
      ? `<img src="${favicon}" style="width:2rem;height:2rem;object-fit:contain;" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'icon-emoji',textContent:'🔗'}))">`
      : `<span class="icon-emoji">${emoji}</span>`;
    el.innerHTML = `${iconHtml}<span class="icon-label">${label}</span>`;

    // drag-to-swap via mousedown+mousemove to avoid blocking dblclick
    let dragSrc = null;
    el.addEventListener('mousedown', e => { if (e.button === 0) dragSrc = id; });
    el.addEventListener('mousemove', e => {
      if (dragSrc && e.buttons === 1) el.classList.add('dragging');
    });
    el.addEventListener('mouseup', () => { el.classList.remove('dragging'); dragSrc = null; });

    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId === id) return;
      const allVisible = [...iconsContainer.querySelectorAll('.icon')].map(i => i.dataset.id);
      const fromIdx = allVisible.indexOf(fromId);
      const toIdx = allVisible.indexOf(id);
      if (fromIdx === -1 || toIdx === -1) return;
      allVisible.splice(fromIdx, 1);
      allVisible.splice(toIdx, 0, fromId);
      if (!desktopState.positions) desktopState.positions = {};
      // save order for ALL currently rendered icons, not just the swapped ones
      [...iconsContainer.querySelectorAll('.icon')].forEach((el, i) => {
        const iconId = el.dataset.id;
        if (!desktopState.positions[iconId]) desktopState.positions[iconId] = {};
        desktopState.positions[iconId].order = i;
      });
      // swap in DOM directly without full re-render
      const fromEl = iconsContainer.querySelector(`[data-id="${fromId}"]`);
      const toEl   = iconsContainer.querySelector(`[data-id="${id}"]`);
      if (fromEl && toEl) {
        const fromNext = fromEl.nextSibling;
        if (toEl.nextSibling === fromEl) {
          iconsContainer.insertBefore(fromEl, toEl);
        } else {
          iconsContainer.insertBefore(fromEl, toEl.nextSibling);
          iconsContainer.insertBefore(toEl, fromNext);
        }
      }
      // update order after DOM swap
      [...iconsContainer.querySelectorAll('.icon')].forEach((el, i) => {
        desktopState.positions[el.dataset.id] = { order: i };
      });
      saveState();
    });

    el.draggable = true;
    el.addEventListener('dblclick', () => {
      if (fsEntry) {
        if (fsEntry.type === 'url')  { window.open(fsEntry.url, '_blank'); return; }
        if (fsEntry.type === 'dir')  { FileManager.openWindow(fsEntry.path); return; }
        if (fsEntry.type === 'app')  { openApp(fsEntry.app_id); return; }
        if (fsEntry.type === 'file') {
          if (ImageViewer.isImage(fsEntry.name))  { ImageViewer.openWindow(fsEntry.path, _desktopEntries); return; }
          if (VideoPlayer.isVideo(fsEntry.name) || VideoPlayer.isAudio(fsEntry.name)) { VideoPlayer.openWindow(fsEntry.path); return; }
        }
        return;
      }
      if (url) { window.open(url, '_blank'); return; }
      openApp(app);
    });

    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const items = fsEntry
        ? [ { label: '🗑️ Delete', action: 'remove', danger: true } ]
        : [ { label: '🗑️ Remove from Desktop', action: 'remove', danger: true } ];
      const ctx = showIconCtx(e.clientX, e.clientY, items);
      ctx.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        hideIconCtx();
        if (fsEntry) {
          await fetch(`/api/files/desktop/entry?path=${encodeURIComponent(fsEntry.path)}`, { method: 'DELETE' });
          await loadDesktopFiles();
          renderIcons();
        } else {
          removeFromDesktop(id);
        }
      });
    });

    iconsContainer.appendChild(el);
  }

  // ── Icon drag ──
  function makeDraggable(el, onDrop) {
    let startX, startY, origX, origY, dragging = false;
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragging = false;
      startX = e.clientX; startY = e.clientY;
      origX = parseInt(el.style.left) || 0;
      origY = parseInt(el.style.top)  || 0;

      function onMove(e) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) dragging = true;
        if (dragging) {
          el.style.left = Math.max(0, origX + dx) + 'px';
          el.style.top  = Math.max(0, origY + dy) + 'px';
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging && onDrop) onDrop();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── App launcher ──
  function openApp(app) {
    if (app === 'terminal') { Terminal.openWindow(); return; }
    if (app === 'filemanager') { FileManager.openWindow(); return; }
    if (app === 'settings') { Settings.openWindow(); return; }
    if (app === 'appstore') { AppStore.openWindow(); return; }
    // mvmOS plugin app
    const tryLaunch = (attempts) => {
      const pluginApp = window.mvmOS?._apps?.[app];
      if (pluginApp?.launch) {
        fetch(`/api/plugins/${app}/open`, { method: 'POST' }).catch(() => {});
        pluginApp.launch();
      } else if (attempts > 0) {
        setTimeout(() => tryLaunch(attempts - 1), 300);
      }
    };
    tryLaunch(5);
  }

  // ── Window factory ──
  function createWindow({ id, title, width = 700, height = 450, onMount, onResize, appSettings }) {
    // bring existing to front if already open
    if (windows[id]) {
      focusWindow(id);
      if (windows[id].minimized) toggleMinimize(id);
      return windows[id].el;
    }

    const el = document.createElement('div');
    el.className = 'window';
    el.dataset.winId = id;

    // center on screen
    const cx = Math.max(20, (window.innerWidth  - width)  / 2 + Math.random() * 40 - 20);
    const cy = Math.max(20, (window.innerHeight - height - 44) / 2 + Math.random() * 40 - 20);
    el.style.cssText = `left:${cx}px;top:${cy}px;width:${width}px;height:${height}px`;

    el.innerHTML = `
      <div class="window-titlebar">
        <div class="window-controls">
          <button class="wbtn wbtn-close"  title="Close"></button>
          <button class="wbtn wbtn-min"    title="Minimize"></button>
          <button class="wbtn wbtn-max"    title="Maximize"></button>
        </div>
        <div class="window-title">${title}</div>
        ${appSettings ? '<button class="wbtn-appsettings" title="App settings">⚙</button>' : ''}
      </div>
      <div class="window-body"></div>
      <div class="window-resize"></div>
    `;

    const titlebar = el.querySelector('.window-titlebar');
    const body     = el.querySelector('.window-body');

    // window drag
    makeWindowDraggable(el, titlebar);
    // window resize
    makeWindowResizable(el, el.querySelector('.window-resize'), () => onResize && onResize(el));

    el.querySelector('.wbtn-close').addEventListener('click', () => closeWindow(id));
    el.querySelector('.wbtn-min').addEventListener('click', () => toggleMinimize(id));
    el.querySelector('.wbtn-max').addEventListener('click', () => toggleMaximize(el));

    if (appSettings) {
      const btn = el.querySelector('.wbtn-appsettings');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        Settings.openWindow(appSettings);
      });
    }

    el.addEventListener('mousedown', () => focusWindow(id));

    desktop.appendChild(el);
    // ensure new window is always on top, even if another window captures mousedown
    zCounter += 10;
    el.style.zIndex = zCounter;
    focusWindow(id);

    windows[id] = { el, title, minimized: false, origStyle: null };

    // taskbar button
    const tbItem = document.createElement('div');
    tbItem.className = 'taskbar-item active';
    tbItem.dataset.winId = id;
    tbItem.textContent = title;
    tbItem.addEventListener('click', () => {
      if (windows[id].minimized) { toggleMinimize(id); focusWindow(id); }
      else focusWindow(id);
    });
    taskbarWindows.appendChild(tbItem);

    if (onMount) onMount(body);
    return el;
  }

  function focusWindow(id) {
    Object.values(windows).forEach(w => w.el.classList.remove('focused'));
    document.querySelectorAll('.taskbar-item').forEach(t => t.classList.remove('active'));
    if (windows[id]) {
      windows[id].el.classList.add('focused');
      windows[id].el.style.zIndex = ++zCounter;
      const tb = taskbarWindows.querySelector(`[data-win-id="${id}"]`);
      if (tb) tb.classList.add('active');
    }
  }

  function closeWindow(id) {
    if (!windows[id]) return;
    windows[id].el.remove();
    taskbarWindows.querySelector(`[data-win-id="${id}"]`)?.remove();
    delete windows[id];
  }

  function toggleMinimize(id) {
    if (!windows[id]) return;
    const w = windows[id];
    w.minimized = !w.minimized;
    w.el.classList.toggle('minimized', w.minimized);
  }

  function toggleMaximize(el) {
    if (el.dataset.maximized) {
      Object.assign(el.style, JSON.parse(el.dataset.origStyle));
      delete el.dataset.maximized;
    } else {
      el.dataset.origStyle = JSON.stringify({ left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height });
      el.style.cssText = 'left:0;top:0;width:100%;height:100%';
      el.dataset.maximized = '1';
    }
  }

  function makeWindowDraggable(win, handle) {
    let startX, startY, origX, origY;
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('wbtn')) return;
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      origX = parseInt(win.style.left) || 0;
      origY = parseInt(win.style.top)  || 0;
      function onMove(e) {
        win.style.left = Math.max(0, origX + e.clientX - startX) + 'px';
        win.style.top  = Math.max(0, origY + e.clientY - startY) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeWindowResizable(win, handle, onChange) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const origW = win.offsetWidth, origH = win.offsetHeight;
      function onMove(e) {
        win.style.width  = Math.max(300, origW + e.clientX - startX) + 'px';
        win.style.height = Math.max(200, origH + e.clientY - startY) + 'px';
        if (onChange) onChange();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Start menu ──
  const startMenu = document.getElementById('start-menu');
  const startSearch = document.getElementById('start-menu-search');
  const startResults = document.getElementById('start-menu-results');
  const startMain = document.getElementById('start-menu-main');

  function _startMenuAllApps() {
    const apps = [
      { id: 'terminal',    label: 'Terminal',     emoji: '🖥️' },
      { id: 'filemanager', label: 'File Manager',  emoji: '📁' },
      { id: 'settings',    label: 'Settings',      emoji: '⚙️' },
      { id: 'appstore',    label: 'App Store',      emoji: '📦' },
    ];
    Object.values(window.mvmOS?._apps || {}).forEach(a => {
      apps.push({ id: a.id, label: a.name, emoji: a.icon || '📦' });
    });
    return apps;
  }

  startSearch.addEventListener('input', () => {
    const q = startSearch.value.trim().toLowerCase();
    if (!q) {
      startResults.style.display = 'none';
      startMain.style.display = '';
      return;
    }
    startMain.style.display = 'none';
    startResults.style.display = '';
    startResults.innerHTML = '';
    const matches = _startMenuAllApps().filter(a => a.label.toLowerCase().includes(q));
    if (!matches.length) {
      startResults.innerHTML = '<div style="padding:8px 14px;font-size:.8rem;color:var(--text-dim)">No results</div>';
      return;
    }
    matches.forEach(a => {
      const el = document.createElement('div');
      el.className = 'start-menu-item';
      el.innerHTML = `<span class="emoji">${a.emoji}</span> ${a.label}`;
      el.addEventListener('click', () => {
        openApp(a.id);
        startMenu.classList.remove('open');
        startSearch.value = '';
        startResults.style.display = 'none';
        startMain.style.display = '';
      });
      startResults.appendChild(el);
    });
  });

  document.getElementById('start-btn').addEventListener('click', e => {
    e.stopPropagation();
    startMenu.classList.toggle('open');
    if (startMenu.classList.contains('open')) {
      setTimeout(() => startSearch.focus(), 50);
    } else {
      startSearch.value = '';
      startResults.style.display = 'none';
      startMain.style.display = '';
    }
  });
  startMenu.querySelectorAll('[data-app]').forEach(item => {
    item.addEventListener('click', () => {
      openApp(item.dataset.app);
      startMenu.classList.remove('open');
    });
  });

    function _startMenuCtx(e, appId, label, emoji) {
    e.preventDefault();
    e.stopPropagation();
    const isBuiltin = BUILTIN_ICONS.find(d => d.id === appId);
    const alreadyOn = isBuiltin
      ? !desktopState.hidden?.[appId]
      : window._desktopIsOn?.(appId);
    const ctx = showIconCtx(e.clientX, e.clientY, [
      alreadyOn
        ? { label: '🗑️ Remove from Desktop', action: 'remove', danger: true }
        : { label: '➕ Add to Desktop', action: 'add' },
    ]);
    ctx.querySelector('[data-action]').addEventListener('click', () => {
      hideIconCtx();
      if (isBuiltin) {
        if (alreadyOn) removeFromDesktop(appId);
        else addToDesktop({ id: appId });
      } else {
        if (alreadyOn) window._desktopRemoveApp?.(appId);
        else window._desktopAddApp?.({ id: appId, label, emoji: emoji || '📦' });
      }
    });
  }

  // built-in start menu items
  startMenu.querySelectorAll('[data-app]').forEach(item => {
    item.addEventListener('contextmenu', e => {
      const emoji = item.querySelector('.emoji')?.textContent || '📦';
      const label = item.textContent.trim();
      _startMenuCtx(e, item.dataset.app, label, emoji);
    });
  });

  // ── Context menu ──
  const ctxMenu = document.getElementById('context-menu');
  desktop.addEventListener('contextmenu', e => {
    if (e.target.closest('.window, .fm-list, .icon')) return;
    e.preventDefault();
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + 'px';
    ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 120) + 'px';
    ctxMenu.classList.add('open');
  });
  // ── New Link ──
  const newLinkDialog = document.getElementById('new-link-dialog');
  const newLinkUrl    = document.getElementById('new-link-url');
  const newLinkLabel  = document.getElementById('new-link-label');

  document.getElementById('ctx-new-link').addEventListener('click', () => {
    ctxMenu.classList.remove('open');
    newLinkUrl.value = '';
    newLinkLabel.value = '';
    newLinkDialog.style.display = 'flex';
    setTimeout(() => newLinkUrl.focus(), 50);
  });

  document.getElementById('new-link-cancel').addEventListener('click', () => {
    newLinkDialog.style.display = 'none';
  });

  document.getElementById('new-link-ok').addEventListener('click', () => addLink());
  newLinkUrl.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });
  newLinkLabel.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });

  async function addLink() {
    let url = newLinkUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const label = newLinkLabel.value.trim() || new URL(url).hostname;
    newLinkDialog.style.display = 'none';
    await fetch('/api/files/desktop/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label }),
    });
    await loadDesktopFiles();
    renderIcons();
  }

  document.getElementById('ctx-new-folder').addEventListener('click', async () => {
    ctxMenu.classList.remove('open');
    const name = prompt('Folder name:');
    if (!name) return;
    await fetch('/api/files/desktop/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadDesktopFiles();
    renderIcons();
  });

  document.getElementById('ctx-files').addEventListener('click', () => { FileManager.openWindow(); ctxMenu.classList.remove('open'); });
  document.getElementById('ctx-widgets').addEventListener('click', () => { WidgetStore.openWindow('desktop'); ctxMenu.classList.remove('open'); });
  document.getElementById('ctx-refresh').addEventListener('click', () => { location.reload(); });

  // ── Taskbar context menu ──
  const taskbarCtx = document.getElementById('taskbar-ctx-menu');
  let _editModeOn = false;

  document.getElementById('taskbar').addEventListener('contextmenu', e => {
    if (e.target.closest('#taskbar-windows') || e.target.closest('#start-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    taskbarCtx.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    taskbarCtx.style.bottom = (window.innerHeight - e.clientY + 4) + 'px';
    taskbarCtx.style.top = 'auto';
    taskbarCtx.classList.add('open');
    // update edit label
    document.getElementById('tctx-edit').textContent = _editModeOn ? '✅ Done Editing' : '✏️ Edit Widgets';
  });

  document.getElementById('tctx-widgets').addEventListener('click', () => {
    taskbarCtx.classList.remove('open');
    WidgetStore.openWindow();
  });

  document.getElementById('tctx-edit').addEventListener('click', () => {
    taskbarCtx.classList.remove('open');
    _editModeOn = !_editModeOn;
    mvmOS._setEditMode(_editModeOn);
  });

  // close menus on outside click
  document.addEventListener('click', () => {
    ctxMenu.classList.remove('open');
    startMenu.classList.remove('open');
    taskbarCtx.classList.remove('open');
    hideIconCtx();
  });

  // ── Switch User ──
  async function loadCurrentUser() {
    try {
      const res = await fetch('/api/auth/whoami');
      const d = await res.json();
      window._effectiveUser = d.effective_user;
      const el = document.getElementById('current-user-label');
      if (el) el.textContent = d.effective_user;
    } catch (_) {}
  }

  function openSwitchUser() {
    startMenu.classList.remove('open');
    Desktop.createWindow({
      id: 'switch-user',
      title: '🔄 Switch User',
      width: 340,
      height: 220,
      onMount(body) {
        body.style.padding = '20px';
        body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:.85rem;color:var(--text-dim)">Current user: <strong id="su-current" style="color:var(--text)"></strong></div>
          <div class="settings-row"><label style="width:90px">Switch to</label><select class="s-input" id="su-user"><option value="">Loading…</option></select></div>
          <div class="settings-row"><label style="width:90px">Password</label><input class="s-input" id="su-pass" type="password" placeholder="password"></div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="s-btn" id="su-btn">Switch</button>
            <span id="su-msg" style="font-size:.82rem"></span>
          </div>
        </div>`;
        body.querySelector('#su-current').textContent = window._effectiveUser || '…';

        // load user list
        fetch('/api/users').then(r => r.json()).then(d => {
          const sel = body.querySelector('#su-user');
          sel.innerHTML = d.users
            .filter(u => u.username !== window._effectiveUser)
            .map(u => `<option value="${u.username}">${u.username} (uid:${u.uid})</option>`)
            .join('');
        });

        const doSwitch = async () => {
          const username = body.querySelector('#su-user').value.trim();
          const password = body.querySelector('#su-pass').value;
          const msg = body.querySelector('#su-msg');
          if (!username || !password) { msg.style.color='#e05555'; msg.textContent='Fill in both fields'; return; }
          const r = await fetch('/api/auth/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });
          if (r.ok) {
            const d = await r.json();
            msg.style.color = '#50fa7b'; msg.textContent = `✓ Switched to ${d.effective_user}`;
            window._effectiveUser = d.effective_user;
            document.getElementById('current-user-label').textContent = d.effective_user;
            setTimeout(() => closeWindow('switch-user'), 800);
          } else {
            const e = await r.json();
            msg.style.color = '#e05555'; msg.textContent = e.detail;
          }
        };
        body.querySelector('#su-btn').addEventListener('click', doSwitch);
        body.querySelector('#su-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doSwitch(); });
      },
    });
  }

  document.getElementById('switch-user-btn').addEventListener('click', openSwitchUser);

  // ── Init ──
  async function init() {
    Settings.initDisplay();
    await loadState();
    await loadDesktopFiles();
    renderIcons();
    await loadCurrentUser();
    // load settings before clock so format is correct on first render
    try {
      const res = await fetch('/api/settings');
      window._vosSettings = await res.json();
    } catch (_) { window._vosSettings = {}; }
    startClock();
    document.addEventListener('mvmos-plugins-loaded', () => renderIcons());
    mvmOS._loadAllPlugins();
    _watchDesktop();
  }

  init();

  return { createWindow, closeWindow, focusWindow };
})();
