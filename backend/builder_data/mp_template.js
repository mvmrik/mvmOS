/*
 * Written by mvmOS App Builder from a platform template. Runs on Game Hub's play page.
 * The game itself is never run here: it runs in a sandbox that has no network, no storage
 * and no access to this page. The only thing it can do is report its score.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  var mp = window.GameHub.mp;
  var ID = __ID__;
  var NAME = __NAME__;
  var ROOM = __ROOM__;
  var started = false;
  var t0 = 0;
  // Messages of a multiplayer game: its server (mp_game.py) and its sandboxed pages talk through these.
  var subs = [], buffer = [], rosterNow = null;
  function emit(ev) { if (!subs.length) { buffer.push(ev); if (buffer.length > 200) buffer.shift(); return; } subs.slice().forEach(function (f) { f(ev); }); }
  if (ROOM) {
    mp.on('bld_roster', function (m) { rosterNow = { kind: 'roster', players: m.players || [], host: m.host || '' }; emit(rosterNow); });
    mp.on('bld_msg', function (m) { emit({ kind: 'message', data: m.data }); });
  }

  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = window.asset ? window.asset(src) : src;
      s.onload = resolve; s.onerror = function () { reject(new Error('Could not load the game runtime')); };
      document.head.appendChild(s);
    });
  }
  // Progress of a game stays in this browser; it is not sent anywhere.
  var kv = {
    get: function (k) { try { var v = localStorage.getItem('mvmgame_' + ID + '_' + k); return Promise.resolve(v == null ? null : JSON.parse(v)); } catch (e) { return Promise.resolve(null); } },
    set: function (k, v) { try { localStorage.setItem('mvmgame_' + ID + '_' + k, JSON.stringify(v)); } catch (e) { /* full */ } return Promise.resolve(true); },
    remove: function (k) { try { localStorage.removeItem('mvmgame_' + ID + '_' + k); } catch (e) { /* none */ } return Promise.resolve(true); },
    list: function (prefix) {
      var out = [], base = 'mvmgame_' + ID + '_';
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k.indexOf(base + (prefix || '')) === 0) out.push({ key: k.slice(base.length), value: JSON.parse(localStorage.getItem(k)) });
        }
      } catch (e) { /* none */ }
      return Promise.resolve(out);
    },
  };

  mp.on('bld_start', function () { started = true; t0 = Date.now(); });

  mp.registerGame({
    id: ID,
    name: NAME,
    renderSetup: function (box) { box.innerHTML = ''; return function () { return {}; }; },
    renderGame: function (root) {
      root.innerHTML = '';
      var box = document.createElement('div');
      box.style.cssText = 'width:100%;height:calc(100vh - 120px);min-height:420px';
      root.appendChild(box);
      var player = window.GameHub.currentPlayer ? window.GameHub.currentPlayer() : null;
      load('/apps/' + ID + '/builder-runtime.js').then(function () { return load('/apps/' + ID + '/bundle.js'); }).then(function () {
        return window.BuilderRuntime.mount(box, {
          room: ROOM ? {
            me: player ? player.id : '',
            send: function (data) { mp.send({ type: 'bld_msg', data: data }); return true; },
            subscribe: function (fn) {
              subs.push(fn);
              if (rosterNow) fn(rosterNow);
              buffer.splice(0).forEach(function (ev) { if (ev !== rosterNow) fn(ev); });
              return function () { subs = subs.filter(function (f) { return f !== fn; }); };
            },
          } : null,
          appId: ID, mode: 'game', sdkUrl: '/apps/' + ID + '/builder-sdk.js', bundle: window.__MVM_BUNDLE, kv: kv, noApps: true,
          user: { name: player ? player.display_name : '' },
          game: {
            player: player ? { name: player.display_name, avatar_svg: player.avatar_svg || null, avatar_color: player.avatar_color || null } : null,
            finish: function (r) {
              mp.send({ type: 'bld_over', score: r.score, stats: r.stats, seconds: r.seconds || Math.round((Date.now() - t0) / 1000) });
              return { recorded: true };
            },
          },
        });
      }).catch(function (e) { box.textContent = (e && e.message) || 'Error'; });
    },
    snapshot: function () { return null; },
  });
})();
