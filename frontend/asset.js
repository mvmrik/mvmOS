// asset(url) — the one way to name a file the browser loads. Returns the URL
// with ?v=<time the file last changed>, so a changed file has a new address and
// no cache can serve an old copy. The times come from window.__assets, which the
// server writes into every page (backend/assets.py). Same function as the
// server's asset(): never write a bare script, stylesheet, image or data path.
(function () {
  var M = window.__assets || {};
  window.asset = function (url) {
    url = String(url == null ? '' : url);
    var q = url.indexOf('?'), path = q < 0 ? url : url.slice(0, q), query = q < 0 ? '' : url.slice(q + 1);
    if (path.charAt(0) !== '/' || path.charAt(1) === '/') return url;
    var key = path, m = /^\/pub\/([^/]+)\/(.+)$/.exec(path);
    if (!(key in M) && m && m[1] !== 'apphub') key = '/apps/' + m[1] + '/' + m[2];
    if (!(key in M)) return url;
    query = query.split('&').filter(function (p) { return p && p.indexOf('v=') !== 0; }).join('&');
    return path + '?' + (query ? query + '&' : '') + 'v=' + M[key];
  };
})();
