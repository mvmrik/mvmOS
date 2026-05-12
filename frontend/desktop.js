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

    function tick() {
      const now = new Date();
      const s = window._vosSettings || {};
      const hour12 = s.time_format === '12';

      let timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });

      // date part
      const fmt = s.date_format || 'DD/MM/YYYY';
      const d = String(now.getDate()).padStart(2, '0');
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const y = now.getFullYear();
      let dateStr;
      if (fmt === 'MM/DD/YYYY')      dateStr = `${m}/${d}/${y}`;
      else if (fmt === 'YYYY-MM-DD') dateStr = `${y}-${m}-${d}`;
      else                           dateStr = `${d}/${m}/${y}`;

      clock.textContent = `${dateStr}  ${timeStr}`;
    }

    tick();
    setInterval(tick, 10000);

    // re-tick when settings change
    window.addEventListener('settings-changed', e => {
      window._vosSettings = e.detail;
      tick();
    });
  }

  // ── Default icons ──
  const DEFAULT_ICONS = [
    { id: 'terminal', label: 'Terminal', emoji: '🖥️', app: 'terminal',    x: 20, y: 20  },
    { id: 'files',    label: 'Files',    emoji: '📁', app: 'filemanager', x: 20, y: 120 },
    { id: 'settings', label: 'Settings', emoji: '⚙️', app: 'settings',   x: 20, y: 220 },
  ];

  function renderIcons() {
    desktop.querySelectorAll('.icon').forEach(el => el.remove());
    const saved = desktopState.icons || {};

    DEFAULT_ICONS.forEach(def => {
      const pos = saved[def.id] || { x: def.x, y: def.y };
      createIcon({ ...def, ...pos });
    });
  }

  function createIcon({ id, label, emoji, app, x, y }) {
    const el = document.createElement('div');
    el.className = 'icon';
    el.dataset.id = id;
    el.dataset.app = app;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.innerHTML = `<span class="icon-emoji">${emoji}</span><span class="icon-label">${label}</span>`;

    makeDraggable(el, () => {
      if (!desktopState.icons) desktopState.icons = {};
      desktopState.icons[id] = {
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
      };
      saveState();
    });

    el.addEventListener('dblclick', () => openApp(app));
    desktop.appendChild(el);
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
    if (app === 'terminal') Terminal.openWindow();
    if (app === 'filemanager') FileManager.openWindow();
    if (app === 'settings') Settings.openWindow();
  }

  // ── Window factory ──
  function createWindow({ id, title, width = 700, height = 450, onMount, onResize }) {
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

    el.addEventListener('mousedown', () => focusWindow(id));

    desktop.appendChild(el);
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
  document.getElementById('start-btn').addEventListener('click', e => {
    e.stopPropagation();
    startMenu.classList.toggle('open');
  });
  startMenu.querySelectorAll('[data-app]').forEach(item => {
    item.addEventListener('click', () => {
      openApp(item.dataset.app);
      startMenu.classList.remove('open');
    });
  });

  // ── Context menu ──
  const ctxMenu = document.getElementById('context-menu');
  desktop.addEventListener('contextmenu', e => {
    e.preventDefault();
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + 'px';
    ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 120) + 'px';
    ctxMenu.classList.add('open');
  });
  document.getElementById('ctx-terminal').addEventListener('click', () => { Terminal.openWindow(); ctxMenu.classList.remove('open'); });
  document.getElementById('ctx-files').addEventListener('click', () => { FileManager.openWindow(); ctxMenu.classList.remove('open'); });
  document.getElementById('ctx-refresh').addEventListener('click', () => { location.reload(); });

  // close menus on outside click
  document.addEventListener('click', () => {
    ctxMenu.classList.remove('open');
    startMenu.classList.remove('open');
  });

  // ── Init ──
  async function init() {
    Settings.initDisplay();
    await loadState();
    renderIcons();
    // load settings before clock so format is correct on first render
    try {
      const res = await fetch('/api/settings');
      window._vosSettings = await res.json();
    } catch (_) { window._vosSettings = {}; }
    startClock();
  }

  init();

  return { createWindow, closeWindow, focusWindow };
})();
