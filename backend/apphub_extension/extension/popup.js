// mvmOS Apps: the Apps Hub public page in a browser popup, through which the
// user opens any public app. It remembers the page the user was on, so the
// popup reopens there, and when a page asks for it, hands over the content of
// the tab the popup was opened on, or of other pages of that site once the
// user allows it. Which app does what with that content is
// never decided here; frontend/extension-bridge.js is the page's side of it.
(function () {
  var ext = globalThis.mvmExt;
  var HOME = '/pub/apphub/';
  var LAST = 'last-path';
  // A product name, the same in every language (see app_apphub in core i18n).
  var HOME_TITLE = 'Apps Hub';

  // A query string can carry a one-time sign-in or reset code; such a page is
  // not worth reopening and its code is not worth keeping in the browser.
  function rememberable(path) {
    if (typeof path !== 'string' || !/^\/(?:api\/)?pub\//.test(path) || /^\/\//.test(path)) return false;
    var query = path.indexOf('?') >= 0 ? path.slice(path.indexOf('?') + 1) : '';
    return !Array.from(new URLSearchParams(query).keys()).some(function (key) {
      return /token|code|key|secret|pass/i.test(key);
    });
  }

  ext.setFramePath(ext.persist.get(LAST).then(function (path) {
    return rememberable(path) ? path : null;
  }));

  // The public page now in the frame; asked-for reading is allowed per page.
  var framePage = '';
  ext.onFrameMessage('location', function (message) {
    framePage = typeof message.path === 'string' ? message.path.split('?')[0] : '';
    // A request stays with the page that made it.
    if (asking) asking.answer(false);
    if (rememberable(message.path)) ext.persist.set(LAST, message.path);
  });

  // Runs in the tab. With no paths it copies the page as it is shown; with
  // paths it opens each of them in a hidden frame of that tab and copies it
  // once it has been drawn, because a site like Hattrick builds some pages in
  // the browser and the HTML its server sends does not hold their content.
  function showPages(paths) {
    var LIMIT = 5 * 1024 * 1024;
    var STEP = 250;
    var QUIET = 3000;
    var MAX = 30000;
    // The page as it is shown: chosen options, typed values and ticks live
    // only as properties, so a copy carries them as attributes.
    function copyOf(doc) {
      var live = doc.querySelectorAll('input, select, textarea');
      var copy = doc.documentElement.cloneNode(true);
      var fields = copy.querySelectorAll('input, select, textarea');
      for (var i = 0; i < live.length && i < fields.length; i++) {
        var el = live[i], to = fields[i];
        if (el.tagName === 'SELECT') {
          for (var j = 0; j < el.options.length && j < to.options.length; j++) {
            if (el.options[j].selected) to.options[j].setAttribute('selected', 'selected');
            else to.options[j].removeAttribute('selected');
          }
        } else if (el.tagName === 'TEXTAREA') {
          to.textContent = el.value;
        } else if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) to.setAttribute('checked', 'checked');
          else to.removeAttribute('checked');
        } else if (el.type !== 'password' && el.type !== 'file') {
          to.setAttribute('value', el.value);
        }
      }
      return copy.outerHTML;
    }
    if (!paths) return {url: location.href, title: document.title, html: copyOf(document)};
    function show(path) {
      return new Promise(function (resolve) {
        var frame = document.createElement('iframe');
        // In the viewport, so what draws only when seen is drawn, yet unseen.
        frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1';
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        var poll = null, cap = null, done = false;
        function finish(page) {
          if (done) return;
          done = true;
          clearInterval(poll);
          clearTimeout(cap);
          frame.remove();
          resolve(page);
        }
        function take() {
          var page = null;
          try {
            var doc = frame.contentDocument, at = frame.contentWindow.location;
            if (doc && at.origin === location.origin && /html/i.test(doc.contentType || '')) {
              var html = copyOf(doc);
              if (html.length <= LIMIT) page = {url: at.href, title: doc.title, html: html};
            }
          } catch (_) {}
          finish(page);
        }
        // Drawn is when for a while neither new elements appear nor new
        // requests are made; a ticking clock changes only text, so it does
        // not keep the page from counting as drawn.
        var seen = '', still = 0;
        frame.onload = function () {
          clearInterval(poll);
          seen = '';
          still = 0;
          poll = setInterval(function () {
            var now = '';
            try {
              var win = frame.contentWindow;
              if (win.document.readyState !== 'complete') return;
              now = win.document.getElementsByTagName('*').length + ':' + win.performance.getEntriesByType('resource').length;
            } catch (_) { return finish(null); }
            if (now !== seen) { seen = now; still = 0; return; }
            if ((still += STEP) >= QUIET) take();
          }, STEP);
        };
        cap = setTimeout(take, MAX);
        frame.src = path;
        (document.body || document.documentElement).appendChild(frame);
      });
    }
    return Promise.all(paths.map(show));
  }

  ext.onFrameMessage('read-page', function (message) {
    ext.executeScript(showPages, [null]).then(function (results) {
      var page = results && results[0] ? results[0].result : null;
      ext.postToFrame({type: 'page', reqId: message.reqId, page: page || null});
    });
  });

  // Other pages of the site the user is on, read in that tab as the signed-in
  // user sees them, so an app can take several pages at once without the user
  // opening each. Only paths on the tab's own site, only a few, and only once
  // the user has allowed it for this app on this site — the question is asked
  // here in the popup, where the page in the frame cannot answer it itself.
  var TEXTS = {
    en: {ask: 'This app wants to read these pages of {site}, as you see them when signed in:', always: 'Don’t ask again for this app on {site}', allow: 'Allow', deny: 'Deny'},
    bg: {ask: 'Това приложение иска да прочете тези страници от {site}, както ги виждаш, когато си влязъл:', always: 'Не питай повече за това приложение в {site}', allow: 'Разреши', deny: 'Откажи'},
    de: {ask: 'Diese App möchte folgende Seiten von {site} lesen, so wie du sie angemeldet siehst:', always: 'Für diese App auf {site} nicht mehr fragen', allow: 'Erlauben', deny: 'Ablehnen'},
    es: {ask: 'Esta app quiere leer estas páginas de {site} tal como las ves con tu sesión iniciada:', always: 'No volver a preguntar para esta app en {site}', allow: 'Permitir', deny: 'Rechazar'},
    fr: {ask: 'Cette app souhaite lire ces pages de {site}, telles que vous les voyez une fois connecté :', always: 'Ne plus demander pour cette app sur {site}', allow: 'Autoriser', deny: 'Refuser'},
    ja: {ask: 'このアプリは、ログインした状態で表示される {site} の次のページを読み取ろうとしています:', always: '{site} でこのアプリについて今後は確認しない', allow: '許可', deny: '拒否'},
    'pt-BR': {ask: 'Este app quer ler estas páginas de {site}, como você as vê quando está conectado:', always: 'Não perguntar de novo para este app em {site}', allow: 'Permitir', deny: 'Negar'},
    ru: {ask: 'Это приложение хочет прочитать эти страницы {site} так, как вы их видите после входа:', always: 'Больше не спрашивать для этого приложения на {site}', allow: 'Разрешить', deny: 'Отклонить'},
    'zh-CN': {ask: '此应用想要读取 {site} 的以下页面，内容与你登录后看到的一致：', always: '在 {site} 上不再为此应用询问', allow: '允许', deny: '拒绝'}
  };
  var text = TEXTS[ext.lang] || TEXTS.en;
  var MAX_PAGES = 20;
  var PAUSE = 1000;
  var asking = null;
  // Allowed once holds while the popup stays open, so an app may read a page
  // again that was not ready the first time without asking twice.
  var allowedNow = {};

  function sitePaths(paths, origin) {
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PAGES) return null;
    var out = [];
    for (var i = 0; i < paths.length; i++) {
      var path = paths[i];
      if (typeof path !== 'string' || path.length > 500 || !/^\/(?![\/\\])/.test(path) || /[\\\s]/.test(path)) return null;
      var url;
      try { url = new URL(path, origin); } catch (_) { return null; }
      if (url.origin !== origin) return null;
      out.push(url.pathname + url.search);
    }
    return out;
  }

  function ask(site, paths) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:10;background:rgba(17,17,27,.82);display:flex;align-items:center;justify-content:center;padding:16px';
      var card = document.createElement('div');
      card.style.cssText = 'background:#1e1e2e;border:1px solid #45475a;border-radius:10px;padding:16px;max-width:520px;width:100%;font-size:13px;line-height:1.45;color:#cdd6f4';
      var p = document.createElement('p');
      p.style.margin = '0 0 8px';
      p.textContent = text.ask.replace('{site}', site);
      var list = document.createElement('ul');
      list.style.cssText = 'margin:0 0 12px;padding-left:18px;max-height:180px;overflow:auto;color:#a6adc8;font-family:ui-monospace,monospace;font-size:12px;word-break:break-all';
      paths.forEach(function (path) {
        var li = document.createElement('li');
        li.textContent = path;
        list.appendChild(li);
      });
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:12px;cursor:pointer';
      var always = document.createElement('input');
      always.type = 'checkbox';
      label.appendChild(always);
      label.appendChild(document.createTextNode(text.always.replace('{site}', site)));
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      var button = function (caption, primary) {
        var b = document.createElement('button');
        b.textContent = caption;
        b.style.cssText = 'border-radius:6px;padding:6px 14px;cursor:pointer;font:inherit;font-weight:600;border:1px solid #45475a;'
          + (primary ? 'background:#89b4fa;color:#11111b;border-color:#89b4fa' : 'background:#313244;color:#cdd6f4');
        row.appendChild(b);
        return b;
      };
      var deny = button(text.deny, false);
      var allow = button(text.allow, true);
      card.appendChild(p);
      card.appendChild(list);
      card.appendChild(label);
      card.appendChild(row);
      box.appendChild(card);
      document.body.appendChild(box);
      asking = {answer: function (yes) {
        asking = null;
        box.remove();
        resolve({yes: yes, always: yes && always.checked});
      }};
      deny.onclick = function () { asking && asking.answer(false); };
      allow.onclick = function () { asking && asking.answer(true); };
      allow.focus();
    });
  }

  ext.onFrameMessage('read-pages', function (message) {
    var reply = function (pages) { ext.postToFrame({type: 'pages', reqId: message.reqId, pages: pages}); };
    var tab = ext.activeTab;
    var origin = '';
    try { origin = new URL(tab && tab.url).origin; } catch (_) {}
    var paths = /^https?:/.test(origin) && !asking ? sitePaths(message.paths, origin) : null;
    if (!paths || !framePage) return reply(null);
    var site = new URL(origin).hostname;
    var page = framePage;
    var key = 'read-pages:' + site + ':' + page;
    ext.persist.get(key).then(function (allowed) {
      return allowed === true || allowedNow[key] ? {yes: true} : ask(site, paths);
    }).then(function (choice) {
      // The frame moved on to another page while the user was deciding.
      if (!choice.yes || page !== framePage) return reply(null);
      if (choice.always) ext.persist.set(key, true);
      else allowedNow[key] = true;
      // One page at a time and a pause between them: the site is not asked
      // for everything at once, and a page being drawn has the tab to itself.
      var pages = [];
      return paths.reduce(function (done, path, i) {
        return done.then(function () {
          if (page !== framePage) throw new Error('moved');
          return ext.executeScript(showPages, [[path]]);
        }).then(function (results) {
          var got = results && results[0] && Array.isArray(results[0].result) ? results[0].result[0] : null;
          pages.push(got || null);
          ext.postToFrame({type: 'pages-progress', reqId: message.reqId, done: i + 1, total: paths.length});
          if (i < paths.length - 1) return new Promise(function (resolve) { setTimeout(resolve, PAUSE); });
        });
      }, Promise.resolve()).then(function () { reply(pages); });
    }).catch(function () { reply(null); });
  });

  var home = document.createElement('button');
  home.id = 'home';
  home.textContent = '🏠';
  home.title = HOME_TITLE;
  home.style.cssText = 'background:none;border:0;color:#a6adc8;cursor:pointer;font-size:15px;padding:3px';
  home.onclick = function () {
    ext.persist.clear(LAST);
    ext.navigateFrame(HOME);
  };
  var settings = document.getElementById('settings');
  settings.parentNode.insertBefore(home, settings);
})();
