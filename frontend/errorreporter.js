// ── Error Reporter — mvmOS ────────────────────────────────────────────────────
// Captures JS errors and backend 5xx responses.
// Shows opt-in dialog — user decides whether to send.
// Reports go to https://mvmos.mvmrik.com/report (independent receiver).

window.ErrorReporter = (() => {
  const t = window.t || (k => k);
  const REPORT_URL = 'https://mvmos.mvmrik.com/report';
  const _buf = [];        // circular buffer, max 20 error entries
  const _fetchLog = [];   // last 10 fetch requests
  let _enabled = true;
  let _dialogOpen = false;
  const _recentShown = {}; // message → timestamp, 10s dedup

  function _push(entry) {
    _buf.push(entry);
    if (_buf.length > 20) _buf.shift();
  }

  function _pushFetch(url, status) {
    _fetchLog.push({ url, status, t: new Date().toISOString() });
    if (_fetchLog.length > 10) _fetchLog.shift();
  }

  function _version() {
    const m = document.querySelector('meta[name="mvmos-version"]');
    return (m && m.getAttribute('content')) || window.MVMOS_VERSION || 'unknown';
  }

  function _activeApps() {
    // Get titles of all open windows
    const wins = document.querySelectorAll('.window');
    if (!wins.length) return null;
    return Array.from(wins).map(w => {
      const title = w.querySelector('.window-title-text, .win-title, [class*="title"]');
      return title ? title.textContent.trim() : w.dataset.winId || '?';
    }).filter(Boolean).join(', ');
  }

  function _parseBrowser(ua) {
    if (!ua) return 'Unknown';
    if (ua.includes('Firefox/')) return 'Firefox ' + ua.match(/Firefox\/([\d.]+)/)?.[1];
    if (ua.includes('Edg/')) return 'Edge ' + ua.match(/Edg\/([\d.]+)/)?.[1];
    if (ua.includes('Chrome/')) return 'Chrome ' + ua.match(/Chrome\/([\d.]+)/)?.[1];
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari ' + ua.match(/Version\/([\d.]+)/)?.[1];
    return ua.slice(0, 60);
  }

  function _parseOS(ua) {
    if (!ua) return 'Unknown';
    if (ua.includes('Windows NT 10')) return 'Windows 10/11';
    if (ua.includes('Windows NT')) return 'Windows';
    if (ua.includes('Mac OS X')) return 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1] || '').replace(/_/g, '.');
    if (ua.includes('Android')) return 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] || '');
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Unknown';
  }

  function _disableForever() {
    _enabled = false;
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { error_reporting: false } }),
    }).catch(() => {});
  }

  function _isDup(msg) {
    const t = _recentShown[msg];
    return t && (Date.now() - t) < 10000;
  }

  function _sendReport(entry) {
    fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:      entry.message,
        stack:        entry.stack || null,
        url:          entry.url || null,
        status:       entry.status || null,
        app:          entry.app || null,
        active_apps:  entry.activeApps || null,
        browser:      navigator.userAgent,
        browser_name: _parseBrowser(navigator.userAgent),
        os:           _parseOS(navigator.userAgent),
        screen:       `${screen.width}x${screen.height}`,
        version:      _version(),
        client_time:  entry.time,
        recent_requests: _fetchLog.slice(-5),
      }),
    }).catch(() => {});
  }

  function _showDialog(entry) {
    if (!_enabled || _dialogOpen || _isDup(entry.message)) return;
    _dialogOpen = true;
    _recentShown[entry.message] = Date.now();

    const ua = navigator.userAgent;
    const browser = _parseBrowser(ua);
    const os = _parseOS(ua);
    const screen_ = `${screen.width}x${screen.height}`;
    const activeApps = _activeApps();
    entry.activeApps = activeApps;

    const recentReqs = _fetchLog.slice(-5);

    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
    overlay.innerHTML = `
      <div style="background:var(--surface,#1e1e2e);border:1px solid var(--border,#313244);border-radius:10px;padding:24px;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5);color:var(--text,#cdd6f4);font-family:inherit">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">${t('errrep_title')}</div>
        <div style="font-size:.85rem;color:var(--text-dim,#a6adc8);margin-bottom:16px">${t('errrep_subtitle')}</div>

        <details style="margin-bottom:16px;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:6px;padding:8px 12px;font-size:.8rem">
          <summary style="cursor:pointer;color:var(--text-dim,#a6adc8);user-select:none">${t('errrep_details')}</summary>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
            <div><b>${t('errrep_message')}</b> ${esc(entry.message)}</div>
            <div><b>${t('errrep_time')}</b> ${esc(entry.time)}</div>
            <div><b>${t('errrep_version')}</b> ${esc(_version())}</div>
            <div><b>${t('errrep_browser')}</b> ${esc(browser)}</div>
            <div><b>${t('errrep_os')}</b> ${esc(os)}</div>
            <div><b>${t('errrep_screen')}</b> ${esc(screen_)}</div>
            ${entry.status ? `<div><b>${t('errrep_http_status')}</b> ${esc(entry.status)}</div>` : ''}
            ${entry.url ? `<div style="word-break:break-all"><b>${t('errrep_url')}</b> ${esc(entry.url)}</div>` : ''}
            ${activeApps ? `<div><b>${t('errrep_open_apps')}</b> ${esc(activeApps)}</div>` : ''}
            ${recentReqs.length ? `
              <div style="margin-top:4px"><b>${t('errrep_recent_requests')}</b></div>
              ${recentReqs.map(r => `<div style="font-size:.72rem;color:var(--text-dim,#a6adc8);word-break:break-all">${esc(r.status)} ${esc(r.url)}</div>`).join('')}
            ` : ''}
            ${entry.stack ? `<pre style="margin:6px 0 0;overflow:auto;font-size:.73rem;white-space:pre-wrap;max-height:110px">${esc(entry.stack.slice(0,600))}</pre>` : ''}
          </div>
        </details>

        <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:.83rem;cursor:pointer;color:var(--text-dim,#a6adc8)">
          <input type="checkbox" id="err-no-more" style="cursor:pointer">
          ${t('errrep_dont_show_again')}
        </label>

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="err-dont" style="padding:7px 16px;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:6px;color:var(--text,#cdd6f4);cursor:pointer;font-size:.85rem;font-family:inherit">${t('errrep_dont_send')}</button>
          <button id="err-send" style="padding:7px 16px;background:var(--accent,#6366f1);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:.85rem;font-weight:600;font-family:inherit">${t('errrep_send_report')}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    function close() { overlay.remove(); _dialogOpen = false; }

    overlay.querySelector('#err-dont').addEventListener('click', () => {
      if (overlay.querySelector('#err-no-more').checked) _disableForever();
      close();
    });
    overlay.querySelector('#err-send').addEventListener('click', () => {
      _sendReport(entry);
      if (overlay.querySelector('#err-no-more').checked) _disableForever();
      close();
    });
  }

  function _capture(type, message, stack, url, status) {
    const entry = {
      time: new Date().toISOString(),
      type, message: String(message || '(unknown)'),
      stack: stack || null, url: url || null, status: status || null,
      app: document.title || 'mvmOS',
    };
    _push(entry);
    if (_enabled && !document.getElementById('screensaver')) _showDialog(entry);
  }

  function _patchFetch() {
    const _orig = window.fetch;
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (url.includes('/report')) return _orig.apply(this, arguments);
      const res = await _orig.apply(this, arguments);
      _pushFetch(url, res.status);
      if (res.status >= 500) {
        let body = '';
        try { body = (await res.clone().text()).slice(0, 400); } catch (_) {}
        _capture('fetch', `HTTP ${res.status} — ${url}`, body || null, url, res.status);
      }
      return res;
    };
  }

  function _patchErrors() {
    window.addEventListener('error', e => {
      _capture('js', e.message, e.error?.stack || null, e.filename || location.href);
    });
    window.addEventListener('unhandledrejection', e => {
      const r = e.reason;
      _capture('promise',
        r instanceof Error ? r.message : String(r || 'Unhandled rejection'),
        r instanceof Error ? r.stack : null,
        location.href
      );
    });
  }

  async function init() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.error_reporting === false) return;
    } catch (_) {}

    _patchFetch();
    _patchErrors();

    window.addEventListener('error-reporting-changed', e => {
      _enabled = e.detail !== false;
    });
  }

  return { init };
})();
