// ── Window manager & desktop shell ──────────────────────────────────────────

const Desktop = (() => {
  let zCounter = 8000;
  let windows = {};     // id → { el, title, minimized }
  let desktopState = { icons: {}, nextId: 1 };

  function isMobile() { return window.innerWidth < 768; }

  // fix viewport height on mobile browsers where window.innerHeight is wrong
  function _fixViewport() {
    const el = document.getElementById('desktop');
    if (el) el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:44px;overflow:hidden;background:linear-gradient(135deg,#0d1117 0%,#0f2027 50%,#0d1117 100%)';
  }
  _fixViewport();
  window.visualViewport?.addEventListener('resize', _fixViewport);
  window.addEventListener('resize', _fixViewport);

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
      if (calPopup) {
        if (isMobile()) {
          const bar = document.getElementById('taskbar-widgets');
          if (bar) calPopup.querySelectorAll('[data-widget-id]').forEach(w => { w.style.display = 'none'; bar.appendChild(w); });
        }
        calPopup.remove(); calPopup = null; return;
      }
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

      // on mobile, show taskbar widgets above calendar
      if (isMobile()) {
        const widgetSection = document.createElement('div');
        widgetSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:10px';
        const bar = document.getElementById('taskbar-widgets');
        if (bar) {
          [...bar.querySelectorAll('[data-widget-id]')].forEach(w => {
            w.style.display = 'flex';
            w.style.minHeight = '36px';
            widgetSection.appendChild(w);
          });
        }
        if (widgetSection.children.length) calPopup.insertBefore(widgetSection, calPopup.firstChild);
      }

      // position above clock
      const rect = clock.getBoundingClientRect();
      calPopup.style.right = (window.innerWidth - rect.right) + 'px';
      calPopup.style.bottom = '44px';

      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!calPopup?.contains(e.target) && e.target !== clock) {
            // return widgets to taskbar on mobile (hidden)
            if (isMobile()) {
              const bar = document.getElementById('taskbar-widgets');
              if (bar) calPopup?.querySelectorAll('[data-widget-id]').forEach(w => { w.style.display = 'none'; bar.appendChild(w); });
            }
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
  function BUILTIN_ICONS() { return [
    { id: 'terminal', label: t('app_terminal'), emoji: '🖥️', app: 'terminal' },
    { id: 'files',    label: t('app_filemanager'), emoji: '🗂️', app: 'filemanager' },
    { id: 'settings', label: t('app_settings'), emoji: '⚙️', app: 'settings' },
  ]; }

  // container for grid icons
  const iconsContainer = document.createElement('div');
  iconsContainer.id = 'desktop-icons';
  desktop.appendChild(iconsContainer);

  let _desktopEntries = []; // from ~/Desktop filesystem
  const _desktopSelected = new Set(); // selected icon ids
  let _desktopLastClicked = null;

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
      const BUILTIN_ICONS_MAP = { terminal: '🖥️', filemanager: '🗂️', appstore: '📦', settings: '⚙️' };
      const appDef = window.mvmOS?._apps?.[entry.app_id];
      const icon = appDef?.icon || BUILTIN_ICONS_MAP[entry.app_id] || '📦';
      return icon.startsWith('/') || icon.startsWith('http') ? { favicon: icon } : { emoji: icon };
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
    BUILTIN_ICONS().forEach((def, i) => {
      if (desktopState.hidden?.[def.id]) return;
      toRender.push({ ...def, order: positions[def.id]?.order ?? i });
    });

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

  function allIconDefs() { return BUILTIN_ICONS(); }

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

    el.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) {
        if (_desktopSelected.has(id)) { _desktopSelected.delete(id); el.classList.remove('selected'); }
        else { _desktopSelected.add(id); el.classList.add('selected'); }
        _desktopLastClicked = id;
      } else if (e.shiftKey && _desktopLastClicked) {
        const icons = [...iconsContainer.querySelectorAll('.icon')];
        const ids = icons.map(i => i.dataset.id);
        const a = ids.indexOf(_desktopLastClicked), b = ids.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        _desktopSelected.clear();
        icons.forEach((ic, i) => {
          if (i >= lo && i <= hi) { _desktopSelected.add(ic.dataset.id); ic.classList.add('selected'); }
          else ic.classList.remove('selected');
        });
      } else {
        _desktopSelected.clear();
        iconsContainer.querySelectorAll('.icon.selected').forEach(ic => ic.classList.remove('selected'));
        _desktopSelected.add(id);
        el.classList.add('selected');
        _desktopLastClicked = id;
      }
    });

    function _openIcon() {
      _desktopSelected.clear();
      iconsContainer.querySelectorAll('.icon.selected').forEach(ic => ic.classList.remove('selected'));
      if (fsEntry) {
        if (fsEntry.type === 'url')  { window.open(fsEntry.url, '_blank'); return; }
        if (fsEntry.type === 'dir')  { FileManager.openWindow(fsEntry.path); return; }
        if (fsEntry.type === 'app')  { openApp(fsEntry.app_id); return; }
        if (fsEntry.type === 'file') {
          if (ImageViewer.isImage(fsEntry.name))  { ImageViewer.openWindow(fsEntry.path, _desktopEntries); return; }
          if (VideoPlayer.isVideo(fsEntry.name) || VideoPlayer.isAudio(fsEntry.name)) { VideoPlayer.openWindow(fsEntry.path); return; }
          if (CodeEditor.isCode(fsEntry.name)) { CodeEditor.openFile(fsEntry.path); return; }
          if (TextEditor.isText(fsEntry.name)) { TextEditor.openWindow(fsEntry.path); return; }
        }
        return;
      }
      if (url) { window.open(url, '_blank'); return; }
      openApp(app);
    }

    let _wasDragged = false;
    let _touchMoved = false;
    let _tapCount = 0, _tapTimer = null;
    const _hasTouch = () => navigator.maxTouchPoints > 0;

    el.addEventListener('dragstart', () => { _wasDragged = true; });
    el.addEventListener('touchstart', () => { _touchMoved = false; }, { passive: true });
    el.addEventListener('touchmove', () => { _touchMoved = true; }, { passive: true });

    // non-touch: dblclick
    el.addEventListener('dblclick', () => {
      if (_hasTouch()) return;
      if (_wasDragged) return;
      _openIcon();
    });

    // touch: count taps manually
    el.addEventListener('click', e => {
      if (!_hasTouch()) return;
      if (_wasDragged) { _wasDragged = false; return; }
      if (_touchMoved) { _touchMoved = false; return; }
      const useSingle = isMobile() && window._vosSettings?.single_click !== false;
      if (useSingle) { _openIcon(); return; }
      _tapCount++;
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(() => { _tapCount = 0; }, 350);
      if (_tapCount >= 2) { _tapCount = 0; clearTimeout(_tapTimer); _openIcon(); }
    });

    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      // ensure right-clicked icon is in selection; if not, reset to just this one
      if (!_desktopSelected.has(id)) {
        _desktopSelected.clear();
        iconsContainer.querySelectorAll('.icon.selected').forEach(ic => ic.classList.remove('selected'));
        _desktopSelected.add(id);
        el.classList.add('selected');
        _desktopLastClicked = id;
      }
      // re-sync DOM selection in case set and DOM drifted
      iconsContainer.querySelectorAll('.icon').forEach(ic => {
        ic.classList.toggle('selected', _desktopSelected.has(ic.dataset.id));
      });
      const selEntries = _desktopEntries.filter(en => {
        const eid = en.type === 'app' ? 'app-' + en.app_id : 'fs-' + en.name;
        return _desktopSelected.has(eid);
      });
      const multi = _desktopSelected.size > 1;
      const items = [];
      if (fsEntry && (fsEntry.type === 'file' || fsEntry.type === 'dir' || fsEntry.type === 'url')) {
        items.push({ label: `📋 Copy${multi ? ' ('+_desktopSelected.size+')' : ''}`, action: 'copy' });
        items.push({ label: `✂️ Cut${multi ? ' ('+_desktopSelected.size+')' : ''}`,  action: 'cut'  });
        items.push('sep');
      }
      if (fsEntry) {
        items.push({ label: `🗑️ ${t('ctx_delete')}${multi ? ' ('+_desktopSelected.size+')' : ''}`, action: 'remove', danger: true });
      } else {
        items.push({ label: `🗑️ ${t('ctx_remove_from_desktop')}`, action: 'remove', danger: true });
      }
      const ctx = showIconCtx(e.clientX, e.clientY, items);
      ctx.querySelector('[data-action="remove"]')?.addEventListener('click', async () => {
        hideIconCtx();
        if (fsEntry) {
          const toDelete = selEntries.length ? selEntries : [fsEntry];
          for (const en of toDelete) {
            await fetch(`/api/files/desktop/entry?path=${encodeURIComponent(en.path)}`, { method: 'DELETE' });
          }
          _desktopSelected.clear();
          await loadDesktopFiles();
          renderIcons();
        } else {
          removeFromDesktop(id);
        }
      });
      ctx.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
        hideIconCtx();
        const paths = selEntries.length ? selEntries.map(en => en.path) : [fsEntry.path];
        window._fmClipboard = { paths, cut: false };
      });
      ctx.querySelector('[data-action="cut"]')?.addEventListener('click', () => {
        hideIconCtx();
        const paths = selEntries.length ? selEntries.map(en => en.path) : [fsEntry.path];
        window._fmClipboard = { paths, cut: true };
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
    if (app === 'msc') { Sites.openWindow(); return; }
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
  function createWindow({ id, title, icon, width = 700, height = 450, onMount, onResize, appSettings, onAppSettings, closeToTray = false }) {
    // bring existing to front if already open (or restore from tray)
    if (_trayItems[id]) { restoreFromTray(id); return windows[id]?.el; }
    if (windows[id]) {
      focusWindow(id);
      if (windows[id].minimized) toggleMinimize(id);
      return windows[id].el;
    }

    const el = document.createElement('div');
    el.className = 'window';
    el.dataset.winId = id;

    const mobile = isMobile();
    if (mobile) {
      el.classList.add('window-mobile');
      el.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:calc(100vh - 44px);z-index:8000;overflow:hidden';
    } else {
      const cx = Math.max(20, (window.innerWidth  - width)  / 2 + Math.random() * 40 - 20);
      const cy = Math.max(20, (window.innerHeight - height - 44) / 2 + Math.random() * 40 - 20);
      el.style.cssText = `left:${cx}px;top:${cy}px;width:${width}px;height:${height}px`;
    }

    el.innerHTML = `
      <div class="window-titlebar">
        <div class="window-controls">
          <button class="wbtn wbtn-close"  title="${t('win_close')}"></button>
          ${!mobile ? `<button class="wbtn wbtn-min" title="${t('win_minimize')}"></button>` : ''}
          ${!mobile ? `<button class="wbtn wbtn-max" title="${t('win_maximize')}"></button>` : ''}
        </div>
        <div class="window-title">${title}</div>
        ${appSettings ? `<button class="wbtn-appsettings" title="${t('settings_title')}">⚙</button>` : ''}
      </div>
      <div class="window-body"></div>
      ${!mobile ? '<div class="window-resize"></div>' : ''}
    `;

    const titlebar = el.querySelector('.window-titlebar');
    const body     = el.querySelector('.window-body');

    if (!mobile) {
      makeWindowDraggable(el, titlebar);
      makeWindowResizable(el, el.querySelector('.window-resize'), () => onResize && onResize(el));
    }

    el.querySelector('.wbtn-close').addEventListener('click', () => closeWindow(id));
    el.querySelector('.wbtn-min')?.addEventListener('click', () => toggleMinimize(id));
    el.querySelector('.wbtn-max')?.addEventListener('click', () => toggleMaximize(el));

    if (appSettings) {
      const btn = el.querySelector('.wbtn-appsettings');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (onAppSettings) onAppSettings();
        else Settings.openWindow(appSettings);
      });
    }

    el.addEventListener('mousedown', () => focusWindow(id));

    desktop.appendChild(el);
    // ensure new window is always on top, even if another window captures mousedown
    zCounter += 10;
    el.style.zIndex = zCounter;
    focusWindow(id);

    windows[id] = { el, title, icon: icon || '📦', minimized: false, origStyle: null, closeToTray };

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

    // on mobile, add sidebar toggle if window has .as-sidebar
    if (mobile) _initMobileSidebar(body);

    return el;
  }

  function focusWindow(id) {
    Object.values(windows).forEach(w => {
      w.el.classList.remove('focused');
      if (isMobile()) w.el.style.display = 'none';
    });
    document.querySelectorAll('.taskbar-item').forEach(t => t.classList.remove('active'));
    if (windows[id]) {
      windows[id].el.classList.add('focused');
      windows[id].el.style.display = '';
      windows[id].el.style.zIndex = ++zCounter;
      const tb = taskbarWindows.querySelector(`[data-win-id="${id}"]`);
      if (tb) tb.classList.add('active');
    }
  }

  // ── System Tray ──────────────────────────────────────────────────────────
  const _trayItems = {}; // id → { icon, title }

  function _renderTray() {
    const tray = document.getElementById('taskbar-tray');
    if (!tray) return;
    tray.innerHTML = '';
    Object.entries(_trayItems).forEach(([id, item]) => {
      const btn = document.createElement('button');
      btn.className = 'tray-item';
      btn.title = item.title;
      btn.textContent = item.icon;
      btn.dataset.winId = id;
      btn.addEventListener('click', () => restoreFromTray(id));
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        document.querySelectorAll('.tray-ctx').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'tray-ctx';
        menu.style.cssText = `position:fixed;left:${e.clientX}px;bottom:${window.innerHeight - e.clientY + 4}px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 0;z-index:9999;min-width:130px;box-shadow:var(--shadow)`;
        [
          { label: item.title, action: () => restoreFromTray(id), style: 'font-weight:600' },
          { label: '─────', disabled: true },
          { label: '✕ ' + (window._t?.('tray_quit') || 'Quit'), action: () => _trayQuit(id), style: 'color:#ff5555' },
        ].forEach(({ label, action, style, disabled }) => {
          const it = document.createElement('div');
          it.textContent = label;
          it.style.cssText = `padding:6px 14px;font-size:.82rem;cursor:${disabled ? 'default' : 'pointer'};color:var(--text);${style || ''}`;
          if (!disabled) {
            it.onmouseenter = () => it.style.background = 'var(--surface3, rgba(255,255,255,.07))';
            it.onmouseleave = () => it.style.background = '';
            it.addEventListener('click', () => { menu.remove(); action(); });
          }
          menu.appendChild(it);
        });
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
      });
      tray.appendChild(btn);
    });
  }

  function sendToTray(id) {
    if (!windows[id]) return;
    const w = windows[id];
    _trayItems[id] = { icon: w.icon || '📦', title: w.title };
    w.el.style.display = 'none';
    taskbarWindows.querySelector(`[data-win-id="${id}"]`)?.remove();
    _renderTray();
  }

  function restoreFromTray(id) {
    if (!_trayItems[id] || !windows[id]) return;
    delete _trayItems[id];
    _renderTray();
    windows[id].el.style.display = '';
    windows[id].minimized = false;
    windows[id].el.classList.remove('minimized');
    // re-add taskbar button
    const existing = taskbarWindows.querySelector(`[data-win-id="${id}"]`);
    if (!existing) {
      const tbItem = document.createElement('div');
      tbItem.className = 'taskbar-item active';
      tbItem.dataset.winId = id;
      tbItem.textContent = windows[id].title;
      tbItem.addEventListener('click', () => {
        if (windows[id].minimized) { toggleMinimize(id); focusWindow(id); }
        else focusWindow(id);
      });
      taskbarWindows.appendChild(tbItem);
    }
    focusWindow(id);
  }

  function _trayQuit(id) {
    delete _trayItems[id];
    _renderTray();
    if (windows[id]) {
      windows[id].el.remove();
      delete windows[id];
    }
  }

  function closeWindow(id) {
    if (!windows[id]) return;
    // if window has close_to_tray active → send to tray instead
    if (windows[id].closeToTray) { sendToTray(id); return; }
    windows[id].el.remove();
    taskbarWindows.querySelector(`[data-win-id="${id}"]`)?.remove();
    delete windows[id];
    // on mobile, focus the previous window if any
    if (isMobile()) {
      const remaining = Object.keys(windows);
      if (remaining.length > 0) focusWindow(remaining[remaining.length - 1]);
    }
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
      { id: 'terminal',    label: t('app_terminal'),     emoji: '🖥️' },
      { id: 'filemanager', label: t('app_filemanager'),  emoji: '📁' },
      { id: 'settings',    label: t('app_settings'),     emoji: '⚙️' },
      { id: 'appstore',    label: t('app_appstore'),     emoji: '📦' },
      { id: 'msc',         label: t('app_msc'),          emoji: '🛠️' },
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
      startResults.innerHTML = `<div style="padding:8px 14px;font-size:.8rem;color:var(--text-dim)">${t('no_results')}</div>`;
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

  // ── Power submenu ──
  let _powerFlyout = null;
  function _closePowerFlyout() {
    if (_powerFlyout) { _powerFlyout.remove(); _powerFlyout = null; document.getElementById('start-menu').style.visibility = ''; }
  }
  function _showPowerOverlay(action) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.5rem';
    const _msg = action === 'restart' ? t('power_restarting') : t('power_stopped');
    ov.innerHTML = `<img src="/logo.png" style="width:min(280px,55vw)"><div style="color:#aaa;font-size:.95rem;font-family:inherit">${_msg}</div>`;
    document.body.appendChild(ov);
    if (action === 'restart') {
      let _wasDown = false;
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/api/auth/whoami', { cache: 'no-store' });
          if (r.status === 502) { _wasDown = true; return; }
          if (_wasDown) { clearInterval(poll); location.reload(); }
        } catch { _wasDown = true; }
      }, 1500);
    }
  }
  window._mvmosShowRestartOverlay = () => _showPowerOverlay('restart');

  function _openPowerFlyout(anchorEl) {
    _closePowerFlyout();
    const items = [
      { emoji: '🔄', labelKey: 'power_restart', action: 'restart' },
      { emoji: '⏹', labelKey: 'power_stop',    action: 'stop' },
    ];
    if (window.innerWidth < 768) {
      const sm = document.getElementById('start-menu');
      const r = sm.getBoundingClientRect();
      sm.style.visibility = 'hidden';
      _powerFlyout = document.createElement('div');
      _powerFlyout.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);display:flex;flex-direction:column;z-index:9600;overflow-y:auto;box-shadow:var(--shadow)`;
      document.body.appendChild(_powerFlyout);
      const back = document.createElement('div');
      back.className = 'start-submenu-item start-submenu-back';
      back.innerHTML = t('back');
      back.addEventListener('click', e => { e.stopPropagation(); _closePowerFlyout(); });
      _powerFlyout.appendChild(back);
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:2px 0';
      _powerFlyout.appendChild(sep);
    } else {
      const rect = anchorEl.getBoundingClientRect();
      _powerFlyout = document.createElement('div');
      _powerFlyout.className = 'start-submenu open';
      _powerFlyout.style.left   = rect.right + 4 + 'px';
      _powerFlyout.style.bottom = window.innerHeight - rect.bottom + 'px';
      document.body.appendChild(_powerFlyout);
    }
    items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'start-submenu-item';
      el.innerHTML = `<span class="emoji">${it.emoji}</span>${t(it.labelKey)}`;
      el.addEventListener('click', async e => {
        e.stopPropagation();
        _closePowerFlyout();
        startMenu.classList.remove('open');
        await fetch(`/api/system/power/${it.action}`, { method: 'POST' }).catch(() => {});
        _showPowerOverlay(it.action);
      });
      _powerFlyout.appendChild(el);
    });
  }
  document.getElementById('start-power-btn').addEventListener('click', e => {
    e.stopPropagation();
    _closeUserFlyout();
    _openPowerFlyout(e.currentTarget);
  });
  document.addEventListener('click', e => {
    if (_powerFlyout && !e.target.closest('#start-power-btn') && !_powerFlyout.contains(e.target)) {
      _closePowerFlyout();
    }
  });

  let _userFlyout = null;
  function _closeUserFlyout() {
    if (_userFlyout) { _userFlyout.remove(); _userFlyout = null; document.getElementById('start-menu').style.visibility = ''; }
  }
  function _openUserFlyout(anchorEl) {
    _closeUserFlyout();
    const items = [
      { emoji: '🔄', labelKey: 'start_switch_user', action: 'switch' },
      { emoji: '🚪', labelKey: 'start_logout',       action: 'logout' },
    ];
    if (window.innerWidth < 768) {
      const sm = document.getElementById('start-menu');
      const r = sm.getBoundingClientRect();
      sm.style.visibility = 'hidden';
      _userFlyout = document.createElement('div');
      _userFlyout.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);display:flex;flex-direction:column;z-index:9600;overflow-y:auto;box-shadow:var(--shadow)`;
      document.body.appendChild(_userFlyout);
      const back = document.createElement('div');
      back.className = 'start-submenu-item start-submenu-back';
      back.innerHTML = t('back');
      back.addEventListener('click', e => { e.stopPropagation(); _closeUserFlyout(); });
      _userFlyout.appendChild(back);
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:2px 0';
      _userFlyout.appendChild(sep);
    } else {
      const rect = anchorEl.getBoundingClientRect();
      _userFlyout = document.createElement('div');
      _userFlyout.className = 'start-submenu open';
      _userFlyout.style.left   = rect.right + 4 + 'px';
      _userFlyout.style.bottom = window.innerHeight - rect.bottom + 'px';
      document.body.appendChild(_userFlyout);
    }
    items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'start-submenu-item';
      el.innerHTML = `<span class="emoji">${it.emoji}</span>${t(it.labelKey)}`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        _closeUserFlyout();
        startMenu.classList.remove('open');
        if (it.action === 'logout') {
          const f = document.createElement('form');
          f.method = 'POST'; f.action = '/logout';
          document.body.appendChild(f); f.submit();
        } else if (it.action === 'switch') {
          openSwitchUser();
        }
      });
      _userFlyout.appendChild(el);
    });
  }
  document.getElementById('start-user-btn').addEventListener('click', e => {
    e.stopPropagation();
    _closePowerFlyout();
    _openUserFlyout(e.currentTarget);
  });
  document.addEventListener('click', e => {
    if (_userFlyout && !e.target.closest('#start-user-btn') && !_userFlyout.contains(e.target)) {
      _closeUserFlyout();
    }
  });

  function _startMenuCtx(e, appId, label, emoji) {
    e.preventDefault();
    e.stopPropagation();
    const isBuiltin = BUILTIN_ICONS().find(d => d.id === appId);
    const alreadyOn = isBuiltin
      ? !desktopState.hidden?.[appId]
      : window._desktopIsOn?.(appId);
    const ctx = showIconCtx(e.clientX, e.clientY, [
      alreadyOn
        ? { label: `🗑️ ${t('ctx_remove_from_desktop')}`, action: 'remove', danger: true }
        : { label: `➕ ${t('ctx_add_to_desktop')}`, action: 'add' },
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
  const ctxPaste = document.getElementById('ctx-paste');
  const ctxPasteSep = document.getElementById('ctx-paste-sep');
  desktop.addEventListener('click', e => {
    if (!e.target.closest('.icon')) {
      _desktopSelected.clear();
      iconsContainer.querySelectorAll('.icon.selected').forEach(ic => ic.classList.remove('selected'));
    }
  });

  desktop.addEventListener('contextmenu', e => {
    if (e.target.closest('.window, .fm-list, .icon')) return;
    e.preventDefault();
    const hasCb = !!window._fmClipboard;
    ctxPaste.style.display = hasCb ? '' : 'none';
    ctxPasteSep.style.display = hasCb ? '' : 'none';
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

  ctxPaste.addEventListener('click', async () => {
    ctxMenu.classList.remove('open');
    const cb = window._fmClipboard;
    if (!cb) return;
    const placesRes = await fetch('/api/files/places');
    const places = await placesRes.json();
    const desktopDir = places.home + '/Desktop';
    const srcPaths = cb.paths || [cb.path];
    for (const src of srcPaths) {
      await fetch('/api/files/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src, dst_dir: desktopDir, move: cb.cut }),
      });
    }
    if (cb.cut) window._fmClipboard = null;
    await loadDesktopFiles();
    renderIcons();
  });

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
    if (e.target.closest('#taskbar-windows') || e.target.closest('#start-btn') || e.target.closest('#taskbar-tray')) return;
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
    WidgetStore.openWindow('taskbar');
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
      const [whoami, sysinfo] = await Promise.all([
        fetch('/api/auth/whoami').then(r => r.json()),
        fetch('/api/system/info').then(r => r.json()).catch(() => ({})),
      ]);
      window._effectiveUser = whoami.effective_user;
      window._hostname = sysinfo.hostname || '';
      const el = document.getElementById('current-user-label');
      if (el) el.textContent = whoami.effective_user;
      if (whoami.effective_user || sysinfo.hostname) {
        document.title = `mvmOS — ${whoami.effective_user}@${sysinfo.hostname || 'localhost'}`;
      }
    } catch (_) {}
  }

  function openSwitchUser() {
    startMenu.classList.remove('open');
    Desktop.createWindow({
      id: 'switch-user',
      title: `🔄 ${t('start_switch_user')}`,
      width: 340,
      height: 220,
      onMount(body) {
        body.style.padding = '20px';
        body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:.85rem;color:var(--text-dim)">${t('switch_user_current')} <strong id="su-current" style="color:var(--text)"></strong></div>
          <div class="settings-row"><label style="width:90px">${t('switch_user_to')}</label><select class="s-input" id="su-user"><option value="">${t('loading')}</option></select></div>
          <div class="settings-row"><label style="width:90px">${t('switch_user_password')}</label><input class="s-input" id="su-pass" type="password" placeholder="${t('switch_user_password_ph')}"></div>
          <div style="display:flex;align-items:center;gap:10px">
            <button class="s-btn" id="su-btn">${t('switch_user_btn')}</button>
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
            document.title = `mvmOS — ${d.effective_user}@${window._hostname || 'localhost'}`;
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

  document.getElementById('switch-user-btn')?.addEventListener('click', openSwitchUser);

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

  // ── Mobile swipe pages ────────────────────────────────────────────────────
  let _mobilePage = 0; // 0 = desktop/icons, 1 = widgets page
  let _swipeStartX = null;

  function _initMobilePages() {
    if (!isMobile()) return;

    // create widget page
    const widgetPage = document.createElement('div');
    widgetPage.id = 'mobile-widget-page';
    widgetPage.style.cssText = 'position:fixed;inset:0 0 44px 0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:16px 12px 32px;gap:12px;transform:translateX(100%);transition:transform .3s ease;background:var(--desktop-bg,#0d1117);z-index:50;box-sizing:border-box';
    document.body.appendChild(widgetPage);
    window._mobileWidgetPage = widgetPage;

    // move desktop widgets into widget page on mobile
    function _collectWidgets() {
      const existing = [...document.querySelectorAll('[data-desktop-widget]')];
      existing.sort((a, b) => {
        const ay = parseInt(a.dataset.wy || a.style.top) || 0;
        const by = parseInt(b.dataset.wy || b.style.top) || 0;
        const ax = parseInt(a.dataset.wx || a.style.left) || 0;
        const bx = parseInt(b.dataset.wx || b.style.left) || 0;
        return ay !== by ? ay - by : ax - bx;
      });
      existing.forEach(w => {
        if (!w.dataset.wx) { w.dataset.wx = parseInt(w.style.left) || 0; }
        if (!w.dataset.wy) { w.dataset.wy = parseInt(w.style.top) || 0; }
        w.style.cssText = 'position:relative;left:auto;top:auto;width:100%;max-width:420px;margin:0 auto;height:auto;min-height:unset';
        widgetPage.appendChild(w);
      });
    }
    // collect after widgets load
    setTimeout(_collectWidgets, 2000);
    // also observe for new widgets
    new MutationObserver(_collectWidgets).observe(desktop, { childList: true });

    // swipe handling on desktop
    document.addEventListener('touchstart', e => {
      _swipeStartX = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchend', e => {
      if (_swipeStartX === null) return;
      const dx = e.changedTouches[0].clientX - _swipeStartX;
      _swipeStartX = null;
      if (Math.abs(dx) < 50) return;
      if (dx < 0 && _mobilePage === 0) _setMobilePage(1);
      else if (dx > 0 && _mobilePage === 1) _setMobilePage(0);
    }, { passive: true });
  }

  function _setMobilePage(page) {
    _mobilePage = page;
    const widgetPage = document.getElementById('mobile-widget-page');
    if (!widgetPage) return;
    if (page === 1) {
      desktop.style.transform = 'translateX(-100%)';
      desktop.style.transition = 'transform .3s ease';
      widgetPage.style.transform = 'translateX(0)';
    } else {
      desktop.style.transform = 'translateX(0)';
      widgetPage.style.transform = 'translateX(100%)';
    }
  }

  function _initMobileSidebar(body) {
    if (!isMobile()) return;
    const sidebar = body.querySelector('.as-sidebar, .fm-places');
    if (!sidebar) return;
    if (body.closest('.window')?.querySelector('.as-mobile-menu-btn')) return; // already added
    const titlebar = body.closest('.window')?.querySelector('.window-titlebar');
    if (!titlebar) return;
    const menuBtn = document.createElement('button');
    menuBtn.className = 'wbtn as-mobile-menu-btn';
    menuBtn.title = 'Menu';
    menuBtn.textContent = '☰';
    menuBtn.style.cssText = 'display:flex;font-size:1rem;margin-right:4px';
    titlebar.querySelector('.window-controls').after(menuBtn);

    sidebar.addEventListener('click', e => {
      if (e.target === sidebar) return; // click on sidebar itself, not a child item
      sidebar.classList.remove('mobile-open');
      body.querySelector('.as-sidebar-overlay')?.remove();
    });

    menuBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = sidebar.classList.toggle('mobile-open');
      if (isOpen) {
        const overlay = document.createElement('div');
        overlay.className = 'as-sidebar-overlay';
        const container = sidebar.parentElement;
        if (container) { container.style.position = 'relative'; container.appendChild(overlay); }
        overlay.addEventListener('click', () => {
          sidebar.classList.remove('mobile-open');
          overlay.remove();
        });
      } else {
        body.querySelector('.as-sidebar-overlay')?.remove();
      }
    });
  }

  init();
  _initMobilePages();
  _initLongPress();

  function _initLongPress() {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;
    let _lpTimer = null;
    let _lpMoved = false;

    document.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      _lpMoved = false;
      _lpTimer = setTimeout(() => {
        if (_lpMoved) return;
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!el) return;
        // find closest element with a contextmenu listener by dispatching the event
        const target = el.closest('[data-desktop-widget]') || el.closest('.icon') || el.closest('.fm-row') || el.closest('.ctx-item') || el;
        target.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
          clientX: touch.clientX, clientY: touch.clientY,
        }));
      }, 500);
    }, { passive: true });

    document.addEventListener('touchmove', () => {
      _lpMoved = true;
      clearTimeout(_lpTimer);
    }, { passive: true });

    document.addEventListener('touchend', () => {
      clearTimeout(_lpTimer);
    }, { passive: true });
  }

  function setWindowCloseToTray(id, val) {
    if (windows[id]) windows[id].closeToTray = val;
  }

  function removeApp(id) {
    _trayQuit(id);
  }

  return { createWindow, closeWindow, focusWindow, openApp, initMobileSidebar: _initMobileSidebar, sendToTray, restoreFromTray, setWindowCloseToTray, removeApp };
})();
