/* Per-browser preference for devices with a physical keyboard (for example a TV).
 * inputmode="none" is a browser hint, so the operating system keeps final control. */
(function () {
  'use strict';
  var scope = (document.currentScript && document.currentScript.dataset.mvmKeyboardScope) || 'system';
  var DISPLAY_KEY = scope === 'public' ? 'apphub_public_display' : 'mvmos_display';
  var MARK = 'data-mvmos-keyboard-inputmode';

  function enabled() {
    try { return JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}').disable_software_keyboard === true; }
    catch (_) { return false; }
  }

  function editable(target) {
    if (!(target instanceof Element)) return null;
    var el = target.closest('input, textarea, [contenteditable]');
    if (!el || el.disabled || el.readOnly || el.getAttribute('contenteditable') === 'false') return null;
    if (el.matches('input')) {
      var type = (el.type || 'text').toLowerCase();
      if (['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].indexOf(type) !== -1) return null;
    }
    return el;
  }

  function suppress(target) {
    if (!enabled()) return;
    var el = editable(target);
    if (!el || el.hasAttribute(MARK)) return;
    el.setAttribute(MARK, el.hasAttribute('inputmode') ? el.getAttribute('inputmode') : '__none__');
    el.setAttribute('inputmode', 'none');
  }

  function restore() {
    document.querySelectorAll('[' + MARK + ']').forEach(function (el) {
      var previous = el.getAttribute(MARK);
      if (previous === '__none__') el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', previous);
      el.removeAttribute(MARK);
    });
  }

  function apply() {
    if (enabled()) suppress(document.activeElement);
    else restore();
  }

  // pointerdown happens before focus, which gives Android browsers the best
  // chance to honour inputmode="none" before they decide to open their IME.
  document.addEventListener('pointerdown', function (event) { suppress(event.target); }, true);
  document.addEventListener('focusin', function (event) { suppress(event.target); }, true);

  window.mvmOSKeyboardPreference = {
    scope: scope,
    apply: apply,
    setEnabled: function (value) {
      try {
        var display = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}');
        display.disable_software_keyboard = value === true;
        localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
      } catch (_) {}
      apply();
    }
  };
  apply();
})();
