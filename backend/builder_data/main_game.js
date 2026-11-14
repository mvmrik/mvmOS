// Written by mvmOS App Builder from a platform template. A game is played on its Game Hub page;
// this window only launches it. The game itself runs in a sandbox (see mp.js).
(function () {
  var ID = __ID__;
  var NAMES = __NAME_I18N__;
  function appName() { var l = (window.mvmOS && mvmOS.lang) || 'en'; return NAMES[l] || NAMES.en || __NAME__; }
  mvmOS.registerApp({
    id: ID,
    name: __NAME__,
    icon: __ICON__,
    category: 'Games',
    launch: function () {
      if (!window.GameLauncher) { mvmOS.notify(appName(), 'This game needs a newer mvmOS.'); return; }
      window.GameLauncher.open({
        id: ID,
        name: appName,
        icon: __ICON__,
        tagline: function () { return t('bld_tagline_' + ID.replace(/-/g, '_')); },
      });
    },
  });
})();
