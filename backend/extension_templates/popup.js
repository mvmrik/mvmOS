(function () {
  var config = globalThis.MVM_EXTENSION_CONFIG;
  var api = globalThis.browser || globalThis.chrome;
  var frame = document.getElementById('frame');
  var errorEl = document.getElementById('error');
  var activeTab = null;
  var runtimeSettings = null;
  var serverOrigin = '';
  var bg = navigator.language.toLowerCase().startsWith('bg');

  function applyWidth(value) {
    var width = Math.min(800, Math.max(300, Number(value) || config.surface.width));
    document.documentElement.style.width = width + 'px';
    document.body.style.width = width + 'px';
    document.body.style.maxWidth = width + 'px';
  }

  applyWidth(config.surface.width);
  document.documentElement.style.height = config.surface.height + 'px';
  document.getElementById('icon').textContent = config.appIcon;
  document.getElementById('name').textContent = config.appName;
  document.getElementById('settings').title = bg ? 'Настройки' : 'Settings';
  document.getElementById('settings').onclick = function () { api.runtime.openOptionsPage(); };

  function defaults() {
    var values = {server_url: config.initialServer, extension_width: config.surface.width};
    (config.settings || []).forEach(function (setting) { values[setting.key] = setting.default; });
    return values;
  }
  function getStorage(values) {
    var result = api.storage.local.get(values);
    return result && typeof result.then === 'function' ? result :
      new Promise(function (resolve) { api.storage.local.get(values, resolve); });
  }
  function getActiveTab() {
    var result = api.tabs.query({active: true, currentWindow: true});
    return result && typeof result.then === 'function'
      ? result.then(function (tabs) { return tabs[0] || null; })
      : new Promise(function (resolve) {
          api.tabs.query({active: true, currentWindow: true}, function (tabs) { resolve(tabs[0] || null); });
        });
  }
  function sendContext(settings) {
    if (!frame.contentWindow || !serverOrigin) return;
    var url = activeTab && activeTab.url ? activeTab.url : '';
    var hostname = '';
    try { hostname = new URL(url).hostname.toLowerCase(); } catch (_) {}
    frame.contentWindow.postMessage({
      source: 'mvmos-extension', appId: config.appId, type: 'context',
      context: {url: url, hostname: hostname}, settings: settings
    }, serverOrigin);
  }
  function autofill(code) {
    if (!activeTab || !activeTab.id || !/^[0-9]{6,8}$/.test(String(code || ''))) return;
    api.scripting.executeScript({
      target: {tabId: activeTab.id},
      func: function (value) {
        var focused = document.activeElement;
        var selector = [
          'input[autocomplete="one-time-code"]', 'input[name*="otp" i]', 'input[id*="otp" i]',
          'input[name*="totp" i]', 'input[id*="totp" i]', 'input[name*="2fa" i]',
          'input[id*="2fa" i]', 'input[name*="code" i]', 'input[id*="code" i]'
        ].join(',');
        var input = focused && focused.matches &&
          focused.matches('input:not([type]),input[type="text"],input[type="tel"],input[type="number"],input[type="password"]')
          ? focused : document.querySelector(selector);
        if (!input) return false;
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        input.focus();
        return true;
      },
      args: [String(code)]
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== serverOrigin) return;
    var message = event.data || {};
    if (message.source !== 'mvmos-public-app' || message.appId !== config.appId) return;
    if (message.action === 'ready' && runtimeSettings) {
      sendContext(runtimeSettings);
      return;
    }
    if (message.action === 'autofill' && (config.capabilities || []).includes('autofill')) autofill(message.code);
  });

  Promise.all([getStorage(defaults()), getActiveTab()]).then(function (values) {
    var settings = values[0];
    runtimeSettings = settings;
    activeTab = values[1];
    applyWidth(settings.extension_width);
    try {
      var parsed = new URL(String(settings.server_url || '').trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      serverOrigin = parsed.origin;
    } catch (_) {
      api.runtime.openOptionsPage();
      window.close();
      return;
    }
    document.getElementById('server').textContent = new URL(serverOrigin).host;
    frame.src = serverOrigin + config.publicUrl;
    frame.addEventListener('load', function () { sendContext(settings); });
  }).catch(function () {
    frame.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = bg ? 'Публичната страница не може да бъде заредена.' : 'The public page could not be loaded.';
  });
})();
