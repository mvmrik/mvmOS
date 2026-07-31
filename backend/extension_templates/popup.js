// The generic popup shell. It knows how to size itself, read its settings,
// resolve the mvmOS server and host the app's public page in an iframe — and
// nothing about what any particular app does with that page.
//
// Everything app-specific (filling a field, unlocking a vault, answering a
// WebAuthn request) lives in the app's own popup script, which core copies into
// the archive from apps/<id>/extension/ and which talks to this shell through
// globalThis.mvmExt. Core never learns what those scripts do.
(function () {
  var config = globalThis.MVM_EXTENSION_CONFIG;
  var api = globalThis.browser || globalThis.chrome;
  var frame = document.getElementById('frame');
  var errorEl = document.getElementById('error');
  var activeTab = null;
  var runtimeSettings = null;
  var serverOrigin = '';
  var bg = navigator.language.toLowerCase().startsWith('bg');
  var frameHandlers = {};
  var readyHandlers = [];
  var frameQuery = null;

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
  function postToFrame(message) {
    if (!frame.contentWindow || !serverOrigin) return false;
    frame.contentWindow.postMessage(
      Object.assign({source: 'mvmos-extension', appId: config.appId}, message), serverOrigin);
    return true;
  }
  function sendContext(settings) {
    var url = activeTab && activeTab.url ? activeTab.url : '';
    var hostname = '';
    try { hostname = new URL(url).hostname.toLowerCase(); } catch (_) {}
    postToFrame({type: 'context', context: {url: url, hostname: hostname}, settings: settings});
  }

  // The surface an app's popup script is written against. Nothing here names a
  // capability or a feature: the shell offers browser plumbing, the app decides
  // what to do with it.
  globalThis.mvmExt = {
    api: api,
    config: config,
    lang: bg ? 'bg' : 'en',
    // How this popup was opened. Which query flags mean what is the app's
    // business — the shell only forwards them.
    query: new URLSearchParams(location.search),
    get activeTab() { return activeTab; },
    get settings() { return runtimeSettings; },
    get serverOrigin() { return serverOrigin; },
    postToFrame: postToFrame,
    // Extra query string for the hosted page's URL, decided before it loads.
    setFrameQuery: function (value) { frameQuery = value; },
    // Fired once the hosted page has announced that it is listening.
    onFrameReady: function (fn) { readyHandlers.push(fn); },
    // Messages the hosted page sends up, keyed by their action name.
    onFrameMessage: function (action, fn) { frameHandlers[action] = fn; },
    // Run a function inside the page the user was looking at.
    executeScript: function (func, args) {
      if (!activeTab || !activeTab.id || !api.scripting) return Promise.resolve(null);
      try {
        var result = api.scripting.executeScript({target: {tabId: activeTab.id}, func: func, args: args || []});
        return Promise.resolve(result).catch(function () { return null; });
      } catch (_) { return Promise.resolve(null); }
    },
    // Session storage, namespaced per app so two extensions cannot collide.
    session: {
      get: function (key) {
        if (!api.storage.session) return Promise.resolve(null);
        var name = config.appId + ':' + key;
        var query = {}; query[name] = null;
        var result = api.storage.session.get(query);
        return (result && typeof result.then === 'function' ? result
          : new Promise(function (resolve) { api.storage.session.get(query, resolve); })
        ).then(function (value) { return value[name]; }).catch(function () { return null; });
      },
      set: function (key, value) {
        if (!api.storage.session) return;
        var payload = {}; payload[config.appId + ':' + key] = value;
        var result = api.storage.session.set(payload);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      },
      clear: function (key) {
        if (!api.storage.session) return;
        var result = api.storage.session.remove(config.appId + ':' + key);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
    },
    setBadge: function (text, color) {
      if (!activeTab || !activeTab.id || !api.action || !api.action.setBadgeText) return;
      try {
        var result = api.action.setBadgeText({tabId: activeTab.id, text: String(text || '')});
        if (result && result.catch) result.catch(function () {});
        if (text && api.action.setBadgeBackgroundColor) {
          var applied = api.action.setBadgeBackgroundColor({tabId: activeTab.id, color: color || '#3671e9'});
          if (applied && applied.catch) applied.catch(function () {});
        }
      } catch (_) {}
    },
    close: function () { window.close(); },
    sendToBackground: function (message) {
      try {
        var result = api.runtime.sendMessage(message);
        if (result && result.then) return result.then(function (value) { return value; }, function () { return null; });
      } catch (_) {}
      return Promise.resolve(null);
    },
    onBackgroundMessage: function (fn) {
      if (api.runtime && api.runtime.onMessage) api.runtime.onMessage.addListener(fn);
    }
  };

  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || event.origin !== serverOrigin) return;
    var message = event.data || {};
    if (message.source !== 'mvmos-public-app' || message.appId !== config.appId) return;
    if (message.action === 'ready') {
      if (runtimeSettings) sendContext(runtimeSettings);
      readyHandlers.forEach(function (fn) { try { fn(); } catch (_) {} });
      return;
    }
    var handler = frameHandlers[message.action];
    if (handler) { try { handler(message); } catch (_) {} }
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
    frame.src = serverOrigin + config.publicUrl +
      (frameQuery ? (config.publicUrl.indexOf('?') >= 0 ? '&' : '?') + frameQuery : '');
    frame.addEventListener('load', function () { sendContext(settings); });
  }).catch(function () {
    frame.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = bg ? 'Публичната страница не може да бъде заредена.' : 'The page could not be loaded.';
  });
})();
