/*
 * mvmOS App Builder — the SDK a generated app sees as the global `mvm`.
 *
 * This file is injected as text into a sandboxed iframe by builder-runtime.js.
 * The iframe has no network, no cookies, no storage and no access to the desktop:
 * everything below talks to the host window with postMessage, and the host
 * decides what is allowed. Nothing here is a security boundary on its own.
 */
(function () {
  'use strict';
  var BOOT = window.__MVM_BOOT || {};
  var pending = {};
  var seq = 0;
  var langHandlers = [];
  var readyResolve;
  var roster = { players: [], host: '' };
  var msgHandlers = [], rosterHandlers = [], pendingMsgs = [];
  var ready = new Promise(function (r) { readyResolve = r; });
  var state = { lang: BOOT.lang || 'en', regional: BOOT.regional || {}, user: BOOT.user || { name: '' }, game: BOOT.game || null };

  function call(op, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      try { parent.postMessage({ mvm: 1, id: id, op: op, args: args || {} }, '*'); }
      catch (e) { delete pending[id]; reject(e); }
    });
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (ev.source !== parent || !m || m.mvm !== 1) return;
    if (m.event === 'lang') {
      state.lang = m.lang; if (m.regional) state.regional = m.regional;
      applyI18n(document);
      langHandlers.slice().forEach(function (fn) { try { fn(state.lang); } catch (e) { report(e); } });
    } else if (m.event === 'room') {
      if (m.kind === 'roster') { roster = { players: m.players || [], host: m.host || '' }; rosterHandlers.slice().forEach(function (fn) { try { fn(roster.players); } catch (e) { report(e); } }); }
      else if (m.kind === 'message') {
        if (!msgHandlers.length) { pendingMsgs.push(m.data); if (pendingMsgs.length > 200) pendingMsgs.shift(); }
        else msgHandlers.slice().forEach(function (fn) { try { fn(m.data); } catch (e) { report(e); } });
      }
    } else if (m.event === 'theme') {
      var s = document.getElementById('mvm-theme');
      if (s) s.textContent = m.css;
    } else if (m.id && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'failed'));
    }
  });

  // ── Texts ────────────────────────────────────────────────────────────────
  function t(key, vars) {
    var tab = (BOOT.i18n || {});
    var s = (tab[state.lang] && tab[state.lang][key]);
    if (s == null) s = tab[BOOT.defaultLang] && tab[BOOT.defaultLang][key];
    if (s == null) s = tab.en && tab.en[key];
    if (s == null) s = key;
    s = String(s);
    if (vars) s = s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : '{' + k + '}'; });
    return s;
  }

  function applyI18n(root) {
    root = root || document;
    var q = function (sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); };
    q('[data-i18n]', function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    q('[data-i18n-placeholder]', function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    q('[data-i18n-title]', function (el) { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    q('[data-i18n-aria]', function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }

  // ── Dates and times follow the person's regional settings ─────────────────
  // The host sends the same settings the shared date picker uses: dateFormat
  // (e.g. DD/MM/YYYY), timeFormat ('12' or '24') and timeZone. Never force
  // a clock, a date order or the browser's time zone in a generated app.
  function pad(n) { return String(n).padStart(2, '0'); }
  function zoned(ms) {
    var r = state.regional || {}, p = {};
    new Intl.DateTimeFormat('en-GB-u-nu-latn', { timeZone: r.timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
  }
  // Accepts a Date, epoch milliseconds, or a canonical 'YYYY-MM-DD', 'HH:MM' or 'YYYY-MM-DDTHH:MM'.
  function toParts(v) {
    if (typeof v === 'string') {
      var m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
      if (m) return { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), min: +(m[5] || 0) };
      m = v.match(/^(\d{2}):(\d{2})$/);
      if (m) return { y: 2000, m: 1, d: 1, h: +m[1], min: +m[2] };
    }
    return zoned(v instanceof Date ? v.getTime() : Number(v));
  }
  var fmt = {
    date: function (v) {
      var p = toParts(v), f = (state.regional.dateFormat || 'DD/MM/YYYY');
      return f.replace('YYYY', String(p.y).padStart(4, '0')).replace('MM', pad(p.m)).replace('DD', pad(p.d));
    },
    time: function (v) {
      var p = toParts(v);
      if (String(state.regional.timeFormat) === '12')
        return new Intl.DateTimeFormat(state.lang, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, p.h, p.min)));
      return pad(p.h) + ':' + pad(p.min);
    },
    dateTime: function (v) { return fmt.date(v) + ' ' + fmt.time(v); },
    number: function (v, o) { return new Intl.NumberFormat(state.lang, o).format(v); },
    // Today's date as the canonical 'YYYY-MM-DD' in the person's time zone, for storing.
    today: function () { var p = zoned(Date.now()); return p.y + '-' + pad(p.m) + '-' + pad(p.d); },
  };

  // ── Errors go to the host so the builder can show and fix them ───────────
  var reported = 0;
  function report(err) {
    if (reported++ > 30) return;
    var msg = err && err.message ? err.message : String(err);
    var stack = err && err.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : '';
    try { parent.postMessage({ mvm: 1, op: 'report', args: { message: msg.slice(0, 400), stack: stack.slice(0, 600) } }, '*'); } catch (e) {}
  }
  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { report(e.reason || 'Unhandled promise rejection'); });
  var origErr = console.error;
  console.error = function () {
    try { report(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ')); } catch (e) {}
    return origErr.apply(console, arguments);
  };

  // ── The public object ────────────────────────────────────────────────────
  var mvm = {
    ready: ready,
    appId: BOOT.appId || '',
    get lang() { return state.lang; },
    get user() { return state.user; },
    t: t,
    applyI18n: applyI18n,
    onLang: function (fn) { if (typeof fn === 'function') langHandlers.push(fn); },
    fmt: fmt,
    asset: function (name) { var a = (BOOT.assets || {})[name]; if (!a) throw new Error('Unknown asset: ' + name); return a; },
    kv: {
      get: function (key) { return call('kv.get', { key: String(key) }); },
      set: function (key, value) { return call('kv.set', { key: String(key), value: value }); },
      remove: function (key) { return call('kv.remove', { key: String(key) }); },
      list: function (prefix) { return call('kv.list', { prefix: prefix ? String(prefix) : '' }); },
    },
    notify: function (title, body) { return call('notify', { title: String(title || ''), body: String(body || '') }); },
    toast: function (text, body) { return call('toast', { text: String(text || ''), body: body ? String(body) : '' }); },
    confirm: function (text, o) { return call('confirm', { text: String(text || ''), options: o || {} }); },
    prompt: function (text, placeholder, value) { return call('prompt', { text: String(text || ''), placeholder: placeholder || '', value: value || '' }); },
    copy: function (text) { return call('copy', { text: String(text == null ? '' : text) }); },
    save: function (filename, text, mime) { return call('save', { filename: String(filename || 'file.txt'), text: String(text == null ? '' : text), mime: mime || 'text/plain' }); },
    pickDateTime: function (o) { return call('pickDateTime', o || {}); },
    apps: {
      list: function () { return call('apps.list'); },
      call: function (appId, fn, args) { return call('apps.call', { app: String(appId), fn: String(fn), args: args || {} }); },
    },
  };

  // The app's own server code (server.py), when it has some: only works once the app is installed.
  mvm.server = {
    get: function (path) { return call('server', { method: 'GET', path: String(path) }); },
    post: function (path, body) { return call('server', { method: 'POST', path: String(path), body: body === undefined ? {} : body }); },
    put: function (path, body) { return call('server', { method: 'PUT', path: String(path), body: body === undefined ? {} : body }); },
    delete: function (path) { return call('server', { method: 'DELETE', path: String(path) }); },
  };

  if (BOOT.room) {
    mvm.room = {
      send: function (data) { return call('room.send', { data: data }); },
      onMessage: function (fn) { if (typeof fn === 'function') { msgHandlers.push(fn); pendingMsgs.splice(0).forEach(function (d) { try { fn(d); } catch (e) { report(e); } }); } },
      onPlayers: function (fn) { if (typeof fn === 'function') { rosterHandlers.push(fn); if (roster.players.length) fn(roster.players); } },
      players: function () { return roster.players; },
      me: function () { return BOOT.room.me || ''; },
      isHost: function () { return !!roster.host && roster.host === (BOOT.room.me || ''); },
    };
  }

  if (state.game) {
    mvm.game = {
      player: function () { return state.game.player || { name: state.user.name, avatar_svg: null }; },
      avatar: function (size) {
        var p = mvm.game.player(); size = size || 32;
        if (p.avatar_svg) return '<span style="display:inline-block;width:' + size + 'px;height:' + size + 'px">' + p.avatar_svg + '</span>';
        var c = (p.avatar_color || '#6b7280');
        var ch = String(p.name || '?').trim().charAt(0).toUpperCase() || '?';
        return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + c + ';color:#fff;font:600 ' + Math.round(size * 0.5) + 'px sans-serif">' + ch + '</span>';
      },
      // Report a finished run: { score: number, stats: {key: number}, seconds: number }
      finish: function (o) { return call('game.finish', o || {}); },
    };
  }

  window.mvm = mvm;
  window.addEventListener('DOMContentLoaded', function () { applyI18n(document); });
  call('hello').then(function () { readyResolve(); applyI18n(document); }, function () { readyResolve(); });
})();
