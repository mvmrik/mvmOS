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
  var TEXTS = {
    en: { settings: 'Settings', loadError: 'The page could not be loaded.' },
    bg: { settings: 'Настройки', loadError: 'Публичната страница не може да бъде заредена.' },
    fr: { settings: 'Paramètres', loadError: "La page n'a pas pu être chargée." },
    es: { settings: 'Ajustes', loadError: 'No se pudo cargar la página.' },
    de: { settings: 'Einstellungen', loadError: 'Die Seite konnte nicht geladen werden.' },
    ru: { settings: 'Настройки', loadError: 'Не удалось загрузить страницу.' },
    'zh-CN': { settings: '设置', loadError: '页面加载失败。' },
    'pt-BR': { settings: 'Configurações', loadError: 'Não foi possível carregar a página.' },
    ja: { settings: '設定', loadError: 'ページを読み込めませんでした。' }
  };
  function detectLang() {
    var codes = Object.keys(TEXTS);
    var nl = (navigator.language || 'en').toLowerCase();
    for (var i = 0; i < codes.length; i++) if (nl === codes[i].toLowerCase()) return codes[i];
    var base = nl.split('-')[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'pt') return 'pt-BR';
    for (var j = 0; j < codes.length; j++) if (codes[j].toLowerCase().split('-')[0] === base) return codes[j];
    return 'en';
  }
  var lang = detectLang();
  var text = TEXTS[lang] || TEXTS.en;
  var frameHandlers = {};
  var readyHandlers = [];
  var frameQuery = null;

  function applyWidth(value) {
    var width = Math.min(800, Math.max(300, Number(value) || config.surface.width));
    document.documentElement.style.width = width + 'px';
    document.body.style.width = width + 'px';
    document.body.style.maxWidth = width + 'px';
  }

  // Height is deliberately never set here. A browser action popup sizes itself
  // to its content up to the browser's own limit (600px), and it is the browser
  // that knows how much room the screen actually has. Writing a height onto the
  // document overrides that measurement with a guess: ask for more than the
  // browser will grant and the popup is still drawn at the limit while the
  // document believes it is taller, leaving the surplus off-screen with no
  // viewport left to scroll it back — which is how the list and the dialog both
  // ended up cut off at the bottom. Letting html/body stay auto-height and
  // giving the frame a fixed pixel height below keeps the two in agreement.
  applyWidth(config.surface.width);
  document.getElementById('icon').textContent = config.appIcon;
  document.getElementById('name').textContent = config.appName;
  document.getElementById('settings').title = text.settings;
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
    lang: lang,
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
    // Storage that outlives the browser, for the rare thing an app is entitled
    // to keep that long — a "stay unlocked for 24 hours" choice is the case it
    // exists for. Same shape and same namespacing as `session` below, so an app
    // picks one or the other by how long the value is allowed to live and
    // nothing else changes.
    persist: {
      get: function (key) {
        var name = config.appId + ':' + key;
        var query = {}; query[name] = null;
        var result = api.storage.local.get(query);
        return (result && typeof result.then === 'function' ? result
          : new Promise(function (resolve) { api.storage.local.get(query, resolve); })
        ).then(function (value) { return value[name]; }).catch(function () { return null; });
      },
      set: function (key, value) {
        var payload = {}; payload[config.appId + ':' + key] = value;
        var result = api.storage.local.set(payload);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      },
      clear: function (key) {
        var result = api.storage.local.remove(config.appId + ':' + key);
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
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

  // The iframe only needs server_url to start loading, so that one setting is
  // read on its own and the page begins fetching while the remaining settings
  // and the active tab are still being resolved. Waiting for all of them first
  // left the popup blank for the whole round trip — the app's page, its scripts
  // and its own data all queued behind a tabs.query that the frame never needed.
  var frameLoaded = false;
  frame.addEventListener('load', function () { frameLoaded = true; });

  // App scripts run after this one and may still call setFrameQuery(), so the
  // src is set on the next task rather than the moment storage answers: by then
  // every app script has executed and the query string is final. This is a turn
  // of the event loop, not a wait on anything.
  var serverReady = Promise.all([
    getStorage({server_url: config.initialServer}),
    new Promise(function (resolve) { setTimeout(resolve, 0); })
  ]).then(function (values) {
    var parsed = new URL(String(values[0].server_url || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    serverOrigin = parsed.origin;
    document.getElementById('server').textContent = new URL(serverOrigin).host;
    // ext=1 tells the server this page is a popup's whole interface, so it is
    // served without the Apps Hub header/footer chrome. The same URL opened in
    // a normal tab still gets it.
    var query = 'ext=1' + (frameQuery ? '&' + frameQuery : '');
    frame.src = serverOrigin + config.publicUrl +
      (config.publicUrl.indexOf('?') >= 0 ? '&' : '?') + query;
  });

  serverReady.catch(function () {
    api.runtime.openOptionsPage();
    window.close();
  });

  Promise.all([serverReady, getStorage(defaults()), getActiveTab()]).then(function (values) {
    var settings = values[1];
    runtimeSettings = settings;
    activeTab = values[2];
    applyWidth(settings.extension_width);
    // The frame may already have loaded while these were resolving, in which
    // case its load event is long gone and the context has to be sent straight
    // away; otherwise it goes as soon as the frame is there.
    if (frameLoaded) sendContext(settings);
    else frame.addEventListener('load', function () { sendContext(settings); });
  }).catch(function () {
    frame.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = text.loadError;
  });
})();
