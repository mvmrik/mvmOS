// Shared accent foregrounds for public pages, including standalone games.
(function () {
  if (window.MvmAccentContrast) { window.MvmAccentContrast.sync(); return; }
  // Public apps share the accent, but do not load the desktop's contrast
  // helper. Resolve colours with CSS rather than privacy-sensitive canvas
  // readback, and choose the more legible foreground for each namespace.
  function syncAccentInk() {
    var root = document.documentElement, colors = getComputedStyle(root);
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    root.appendChild(probe);
    function rgb(value) {
      probe.style.color = '';
      probe.style.color = value.trim();
      if (!probe.style.color) return null;
      var text = getComputedStyle(probe).color;
      var match = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/)
        || text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
      if (!match) return null;
      var scale = text.indexOf('color(') === 0 ? 255 : 1;
      var alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : +match[4];
      return [+match[1] * scale, +match[2] * scale, +match[3] * scale, alpha];
    }
    ['', 'pub-'].forEach(function (prefix) {
      var accent = rgb(colors.getPropertyValue('--' + prefix + 'accent') || colors.getPropertyValue('--accent'));
      if (!accent) {
        // A page may return to app-owned dark defaults with no root accent.
        // Discard the previous light theme's ink so app fallbacks can apply.
        var staleKey = '--' + prefix + 'on-accent';
        if (root.style.getPropertyValue(staleKey)) root.style.removeProperty(staleKey);
        return;
      }
      var surface = rgb(colors.getPropertyValue('--' + prefix + 'surface1') || colors.getPropertyValue('--surface1')) || [255, 255, 255, 1];
      var linear = accent.slice(0, 3).map(function (v, i) {
        v = (v * accent[3] + surface[i] * (1 - accent[3])) / 255;
        return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
      });
      var luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
      var key = '--' + prefix + 'on-accent';
      var ink = (luminance + .05) / .05 > 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
      if (root.style.getPropertyValue(key) !== ink) root.style.setProperty(key, ink);
    });
    probe.remove();
  }

  window.MvmAccentContrast = { sync: syncAccentInk };
  syncAccentInk();
  var observer = new MutationObserver(syncAccentInk);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media'] });
  document.addEventListener('load', function (event) {
    if (event.target instanceof HTMLLinkElement) syncAccentInk();
  }, true);
  document.addEventListener('DOMContentLoaded', syncAccentInk);
})();
