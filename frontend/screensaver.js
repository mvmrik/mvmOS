const ScreenSaver = (() => {
  let _timer = null;
  let _active = false;
  let _animFrame = null;
  let _overlay = null;
  let _timeoutMin = 0;
  let _photoTimer = null;

  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];

  function _getTimeout() {
    return parseInt(localStorage.getItem('ss_timeout') ?? '5');
  }
  function _needsPassword() {
    return localStorage.getItem('ss_password') === '1';
  }

  function _resetTimer() {
    clearTimeout(_timer);
    _timeoutMin = _getTimeout();
    if (_timeoutMin > 0 && !_active) {
      _timer = setTimeout(activate, _timeoutMin * 60 * 1000);
    }
  }

  function _stopPollers() {
    window._ssPollersPaused = true;
  }
  function _resumePollers() {
    window._ssPollersPaused = false;
  }

  // Floating logo animation
  function _startFloat(img) {
    let x = 40, y = 40, vx = 0.4, vy = 0.3;
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.25;
    img.style.width = size + 'px';

    function step() {
      const maxX = window.innerWidth  - size;
      const maxY = window.innerHeight - size;
      x += vx; y += vy;
      if (x <= 0 || x >= maxX) { vx = -vx; x = Math.max(0, Math.min(x, maxX)); }
      if (y <= 0 || y >= maxY) { vy = -vy; y = Math.max(0, Math.min(y, maxY)); }
      img.style.left = x + 'px';
      img.style.top  = y + 'px';
      _animFrame = requestAnimationFrame(step);
    }
    _animFrame = requestAnimationFrame(step);
  }

  function _showPasswordPrompt(onSuccess) {
    const wrap = document.createElement('div');
    wrap.id = 'ss-unlock';
    wrap.innerHTML = `
      <div id="ss-unlock-box">
        <img src="/logo.png" style="width:72px;margin-bottom:1rem">
        <p id="ss-unlock-user"></p>
        <input id="ss-unlock-pw" type="password" placeholder="${window._i18n?.ss_password_ph || 'Password'}" autocomplete="current-password">
        <button id="ss-unlock-btn">${window._i18n?.ss_unlock || 'Unlock'}</button>
        <p id="ss-unlock-err"></p>
      </div>`;
    _overlay.appendChild(wrap);

    fetch('/api/auth/whoami').then(r => r.json()).then(d => {
      const u = wrap.querySelector('#ss-unlock-user');
      if (u) u.textContent = d.effective_user || '';
    }).catch(() => {});

    const pw  = wrap.querySelector('#ss-unlock-pw');
    const btn = wrap.querySelector('#ss-unlock-btn');
    const err = wrap.querySelector('#ss-unlock-err');

    pw.focus();

    async function tryUnlock() {
      btn.disabled = true;
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw.value }),
      });
      if (res.ok) { onSuccess(); }
      else {
        err.textContent = window._i18n?.ss_wrong_password || 'Wrong password';
        pw.value = '';
        pw.focus();
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', tryUnlock);
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

    // stop activity events from deactivating while prompt is shown
    wrap.addEventListener('mousemove',  e => e.stopPropagation());
    wrap.addEventListener('mousedown',  e => e.stopPropagation());
    wrap.addEventListener('keydown',    e => e.stopPropagation());
    wrap.addEventListener('touchstart', e => e.stopPropagation());
  }

  function _showLogo(overlay) {
    const img = document.createElement('img');
    img.src = '/logo.png';
    img.alt = 'mvmOS';
    img.id = 'ss-logo';
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    _startFloat(img);
  }

  function _startWidget(overlay, def) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;z-index:2;border-radius:var(--radius);overflow:hidden;min-width:120px;';
    overlay.appendChild(wrap);

    const body = document.createElement('div');
    body.className = 'widget-body';
    wrap.appendChild(body);

    try { def.init(body); } catch(e) { console.error('ss widget init', e); }

    // start floating after widget renders
    requestAnimationFrame(() => {
      const w = wrap.offsetWidth || 200;
      const h = wrap.offsetHeight || 150;
      let x = Math.random() * (window.innerWidth - w);
      let y = Math.random() * (window.innerHeight - h);
      let vx = (Math.random() > 0.5 ? 1 : -1) * 0.4;
      let vy = (Math.random() > 0.5 ? 1 : -1) * 0.3;

      function step() {
        const maxX = window.innerWidth - wrap.offsetWidth;
        const maxY = window.innerHeight - wrap.offsetHeight;
        x += vx; y += vy;
        if (x <= 0 || x >= maxX) { vx = -vx; x = Math.max(0, Math.min(x, maxX)); }
        if (y <= 0 || y >= maxY) { vy = -vy; y = Math.max(0, Math.min(y, maxY)); }
        wrap.style.left = x + 'px';
        wrap.style.top  = y + 'px';
        _animFrame = requestAnimationFrame(step);
      }
      _animFrame = requestAnimationFrame(step);
    });

    // refresh widget every 3s
    const refreshSec = Math.max(1, parseInt(window._vosSettings?.widget_refresh) || 3);
    _photoTimer = setInterval(() => {
      try { if (def.refresh) def.refresh(body); else { body.innerHTML = ''; def.init(body); } } catch(e) {}
    }, refreshSec * 1000);
  }

  async function _startPhotos(overlay) {
    const folder = localStorage.getItem('ss_photos_folder') || '';
    const periodMin = parseInt(localStorage.getItem('ss_photos_period') || '5');

    // fetch user home
    let basePath = '';
    try {
      const r = await fetch('/api/auth/whoami');
      const d = await r.json();
      const u = d.effective_user;
      basePath = u === 'root' ? '/root' : `/home/${u}`;
    } catch { basePath = '/root'; }
    const dirPath = folder ? `${basePath}/${folder}` : basePath;
    const isRoot = basePath === '/root';

    const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg']);
    let photos = [];
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}${isRoot ? '&as_root=true' : ''}`);
      const d = await r.json();
      photos = (d.entries || [])
        .filter(e => (e.type === 'file' || !e.is_dir) && IMAGE_EXT.has(e.name.split('.').pop().toLowerCase()))
        .map(e => `/api/files/raw?path=${encodeURIComponent(dirPath + '/' + e.name)}`);
    } catch {}

    if (!photos.length) {
      // fallback to logo if no photos
      const img = document.createElement('img');
      img.src = '/logo.png'; img.alt = 'mvmOS'; img.id = 'ss-logo';
      overlay.appendChild(img);
      _startFloat(img);
      return;
    }

    // shuffle
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }

    let idx = 0;
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat;transition:opacity 1s ease';
    overlay.appendChild(bg);

    function showPhoto() {
      bg.style.opacity = '0';
      setTimeout(() => {
        bg.style.backgroundImage = `url('${photos[idx]}')`;
        bg.style.opacity = '1';
        idx = (idx + 1) % photos.length;
      }, 1000);
    }
    showPhoto();
    _photoTimer = setInterval(showPhoto, periodMin * 60 * 1000);
  }

  function activate() {
    if (_active) return;
    _active = true;
    _stopPollers();

    _overlay = document.createElement('div');
    _overlay.id = 'screensaver';

    const ssType = localStorage.getItem('ss_type') || 'logo';

    if (ssType === 'photos') {
      document.body.appendChild(_overlay);
      requestAnimationFrame(() => _overlay.classList.add('visible'));
      _startPhotos(_overlay);
    } else if (ssType === 'widget') {
      const widgetId = localStorage.getItem('ss_widget_id');
      const def = widgetId && window.mvmOS?._widgets?.[widgetId];
      if (def) {
        document.body.appendChild(_overlay);
        requestAnimationFrame(() => _overlay.classList.add('visible'));
        _startWidget(_overlay, def);
      } else {
        _showLogo(_overlay);
      }
    } else {
      _showLogo(_overlay);
    }

    function onActivity() {
      if (!_active) return;
      if (_needsPassword()) {
        const existing = document.getElementById('ss-unlock');
        if (!existing) _showPasswordPrompt(deactivate);
      } else {
        deactivate();
      }
    }

    ACTIVITY_EVENTS.forEach(ev => _overlay.addEventListener(ev, onActivity, { once: false }));
    _overlay._onActivity = onActivity;
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    _resumePollers();
    cancelAnimationFrame(_animFrame);
    clearInterval(_photoTimer); _photoTimer = null;
    if (_overlay) {
      _overlay.classList.remove('visible');
      setTimeout(() => { _overlay?.remove(); _overlay = null; }, 500);
    }
    _resetTimer();
  }

  function applyTimeout(min) {
    _timeoutMin = min;
    clearTimeout(_timer);
    if (min > 0 && !_active) {
      _timer = setTimeout(activate, min * 60 * 1000);
    }
  }

  function init() {
    ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, _resetTimer, { passive: true }));
    _resetTimer();
  }

  return { init, activate, deactivate, applyTimeout };
})();
