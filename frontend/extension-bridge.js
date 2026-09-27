// Lets a public page shown inside the mvmOS Apps browser extension know which
// site the user is looking at, and read that page, or other pages of the same
// site once the user allows it, when it asks to.
//
// Core adds this to every public HTML page (see extension_bridge_middleware in
// backend/main.py). Outside the extension it does nothing: the page is not in
// an extension popup, no context ever arrives, and mvmOS.extension.active stays
// false. What a page does with the site it is on is entirely the page's own
// business; this file only carries the messages.
(function () {
  'use strict';
  var APP_ID = 'apphub';
  var mvmOS = window.mvmOS = window.mvmOS || {};
  if (mvmOS.extension) return;

  var parentOrigin = null;
  var context = null;
  var listeners = [];
  var pending = {};
  var progress = {};
  var seq = 0;

  function post(message) {
    window.parent.postMessage(Object.assign({source: 'mvmos-public-app', appId: APP_ID}, message), parentOrigin);
  }

  mvmOS.extension = {
    // True once the extension has told this page which site it is on.
    get active() { return !!context; },
    // {url, hostname} of the tab the user opened the extension on, or null.
    get context() { return context; },
    // Called with the context as soon as it is known, and again if it changes.
    onContext: function (fn) {
      listeners.push(fn);
      if (context) { try { fn(context); } catch (_) {} }
    },
    // The HTML of the tab the user opened the extension on, as {url, title,
    // html}, or null when the extension is not there or the browser refuses
    // (its own pages, the web store). Read only when the user asks for it.
    readPage: function () {
      if (!context || !parentOrigin) return Promise.resolve(null);
      var reqId = 'p' + (++seq);
      return new Promise(function (resolve) {
        var timer = setTimeout(function () { delete pending[reqId]; resolve(null); }, 15000);
        pending[reqId] = function (page) { clearTimeout(timer); resolve(page || null); };
        post({action: 'read-page', reqId: reqId});
      });
    },
    // Other pages of that same site, read in its tab as the signed-in user
    // sees them, once each has been drawn: paths such as '/Club/?id=1', at
    // most twenty, one after another. Resolves to one {url, title, html} or null
    // per path, in order, or to null altogether when the extension is not
    // there or the user does not allow it. The extension asks the user first,
    // in its own popup. onProgress, if given, is called with (done, total)
    // after each page.
    readPages: function (paths, onProgress) {
      if (!context || !parentOrigin || !Array.isArray(paths) || !paths.length) return Promise.resolve(null);
      var reqId = 'p' + (++seq);
      return new Promise(function (resolve) {
        // Long enough for the user to read the question and answer it, and
        // started again by every page read.
        var timer = null;
        var wait = function () {
          clearTimeout(timer);
          timer = setTimeout(function () { delete pending[reqId]; delete progress[reqId]; resolve(null); }, 180000);
        };
        wait();
        pending[reqId] = function (pages) {
          clearTimeout(timer);
          delete progress[reqId];
          resolve(Array.isArray(pages) ? pages : null);
        };
        progress[reqId] = function (done, total) {
          wait();
          if (typeof onProgress === 'function') { try { onProgress(done, total); } catch (_) {} }
        };
        post({action: 'read-pages', reqId: reqId, paths: paths.map(String)});
      });
    }
  };

  if (window.parent === window) return;

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !/^(?:chrome|moz)-extension:\/\//.test(event.origin)) return;
    var message = event.data || {};
    if (message.source !== 'mvmos-extension' || message.appId !== APP_ID) return;
    if (message.type === 'context') {
      parentOrigin = event.origin;
      var next = message.context || {};
      context = {url: String(next.url || ''), hostname: String(next.hostname || '')};
      // The popup remembers where the user was, so the next time it opens on
      // this page rather than on Apps Hub's front page.
      post({action: 'location', path: location.pathname + location.search});
      listeners.forEach(function (fn) { try { fn(context); } catch (_) {} });
    } else if (message.type === 'pages-progress' && progress[message.reqId]) {
      progress[message.reqId](+message.done || 0, +message.total || 0);
    } else if ((message.type === 'page' || message.type === 'pages') && pending[message.reqId]) {
      var done = pending[message.reqId];
      delete pending[message.reqId];
      done(message.type === 'page' ? message.page : message.pages);
    }
  });
  // The origin is not known until the extension answers, and "ready" carries
  // nothing but the fact that this page is listening.
  window.parent.postMessage({source: 'mvmos-public-app', appId: APP_ID, action: 'ready'}, '*');
})();
