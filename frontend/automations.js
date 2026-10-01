/**
 * mvmOS Automations — the desktop window.
 * Rules belong to the Apps Hub profile this browser is signed in to, the same
 * ones the public page (/pub/automations/) shows. The editor itself is shared
 * with that page and loaded from /pub/automations/ui.js; settings are in the
 * window's gear (Settings → Automations).
 */
const AutomationsApp = (() => {
  const WIN_ID = 'automations';
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  let _ui = null;
  let _loading = null;

  function _headers() {
    return window.mvmOS && mvmOS._pubHeaders ? mvmOS._pubHeaders() : { 'X-Mvm-Surface': 'desktop' };
  }

  function _loadUI() {
    if (window.AutomationsUI) return Promise.resolve();
    if (_loading) return _loading;
    _loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = window.asset ? asset('/pub/automations/ui.js') : '/pub/automations/ui.js';
      s.onload = resolve;
      s.onerror = () => { _loading = null; reject(); };
      document.head.appendChild(s);
    });
    return _loading;
  }

  function _signIn(body) {
    body.innerHTML = `<div style="padding:32px 16px;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center">
      <div style="opacity:.8">${t('auto_signin')}</div>
      <button class="s-btn" id="auto-signin">${t('auto_signin_btn')}</button></div>`;
    body.querySelector('#auto-signin').addEventListener('click', () => {
      if (typeof AppHub !== 'undefined') AppHub.requireLogin(() => _mount(body));
    });
  }

  async function _mount(body) {
    if (_ui) { _ui.destroy(); _ui = null; }
    const user = typeof AppHub !== 'undefined' ? await AppHub.getUser() : null;
    if (!user) { _signIn(body); return; }
    try { await _loadUI(); }
    catch (_) { body.textContent = t('auto_error_generic'); return; }
    _ui = AutomationsUI.mount(body, { base: '/pub/automations', headers: _headers, onAuth: () => _signIn(body) });
  }

  function openWindow() {
    Desktop.createWindow({
      id: WIN_ID,
      title: '⚡ ' + t('app_automations'),
      width: 760,
      height: 640,
      appSettings: 'automations',
      onMount(body) {
        body.style.cssText = 'padding:14px;overflow:auto';
        _mount(body);
      },
      onClose() {
        if (_ui) { _ui.destroy(); _ui = null; }
      },
    });
  }

  return { openWindow };
})();
