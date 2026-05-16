const ScreenSaver = (() => {
  let _timer = null;
  let _active = false;
  let _animFrame = null;
  let _overlay = null;
  let _timeoutMin = 0;

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

  function activate() {
    if (_active) return;
    _active = true;
    _stopPollers();

    _overlay = document.createElement('div');
    _overlay.id = 'screensaver';

    const img = document.createElement('img');
    img.src = '/logo.png';
    img.alt = 'mvmOS';
    img.id = 'ss-logo';
    _overlay.appendChild(img);

    document.body.appendChild(_overlay);
    requestAnimationFrame(() => _overlay.classList.add('visible'));
    _startFloat(img);

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
