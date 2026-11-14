// Written by mvmOS App Builder from a platform template. It only opens the app in its sandbox.
(function () {
  var ID = __ID__;
  var NAMES = __NAME_I18N__;
  function appName() { var l = (window.mvmOS && mvmOS.lang) || 'en'; return NAMES[l] || NAMES.en || __NAME__; }
  mvmOS.registerApp({
    id: ID,
    name: __NAME__,
    icon: __ICON__,
    category: __CATEGORY__,
    requires_apphub: __REQUIRES__,
    launch: function () {
      if (!window.BuilderRuntime) { mvmOS.notify(appName(), 'This app needs a newer mvmOS.'); return; }
      window.BuilderRuntime.openInstalled({ id: ID, name: appName(), icon: __ICON__ });
    },
  });
})();
