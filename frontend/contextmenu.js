/**
 * mvmOS system context menu
 * One right-click menu for the whole desktop, so the browser's own menu never
 * appears inside mvmOS. It offers the everyday actions (cut, copy, paste,
 * select all, links, reload) plus "Paste to mvmOS Clipboard".
 *
 * It only steps in when nobody else has: an app or window that shows its own
 * menu calls preventDefault() on the event, and this listener — on document,
 * so it runs last — leaves it alone. Two escape hatches keep the browser's
 * menu: holding Shift, and a data-native-menu attribute on an element (or any
 * ancestor). Phone-sized screens keep the browser's long-press behaviour,
 * where text selection matters more than a menu.
 */
const ContextMenu = (() => {
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TEXT_INPUTS = ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''];

  let _menu = null;

  // xterm.js keeps its selection inside the Terminal object, not in the page's
  // selection, so remember which element belongs to which terminal. Wrapping
  // open() covers the desktop Terminal and any app that uses xterm too.
  const _terms = new WeakMap();
  (function hookXterm() {
    const proto = window.Terminal && window.Terminal.prototype;
    if (!proto || proto.__mvmCtxHooked || typeof proto.open !== 'function') return;
    const open = proto.open;
    proto.open = function (...args) {
      const r = open.apply(this, args);
      if (this.element) _terms.set(this.element, this);
      return r;
    };
    proto.__mvmCtxHooked = true;
  })();

  function _toast(body) {
    if (window.mvmOS && mvmOS.toast) mvmOS.toast(t('app_clipboard'), body);
  }

  // ── What was clicked ──────────────────────────────────────────────────
  function _editableOf(target) {
    const el = target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    if (!el) return null;
    if (el.tagName === 'INPUT' && !TEXT_INPUTS.includes((el.getAttribute('type') || '').toLowerCase())) return null;
    return el;
  }

  function _selectedText(target, editable, term) {
    if (term) return term.hasSelection() ? term.getSelection() : '';
    if (editable && typeof editable.selectionStart === 'number') {
      if (editable.type === 'password') return '';
      return editable.value.slice(editable.selectionStart, editable.selectionEnd);
    }
    return String(window.getSelection ? window.getSelection() : '');
  }

  function _linkOf(target) {
    const a = target.closest('a[href]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    if (/^\s*javascript:/i.test(href) || href.startsWith('#')) return null;
    return a.href;
  }

  // ── Actions ───────────────────────────────────────────────────────────
  async function _writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function _replaceSelection(el, text) {
    el.focus();
    if (document.execCommand('insertText', false, text)) return;
    if (typeof el.setRangeText === 'function') {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function _pasteInto(el, term) {
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch (_) { _toast(t('clip_paste_blocked')); return; }
    if (!text) return;
    if (term) { term.paste(text); term.focus(); return; }
    el.focus();
    // Editors that manage their own content listen for the paste event and
    // cancel it; only a plain field is left for the browser-style insert.
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (!ev.defaultPrevented) _replaceSelection(el, text);
  }

  async function _cut(el, text) {
    el.focus();
    if (document.execCommand('cut')) return;
    if (await _writeText(text)) _replaceSelection(el, '');
  }

  // ── Building and showing ──────────────────────────────────────────────
  function _items(target) {
    const term = (() => {
      const host = target.closest('.xterm');
      return host ? _terms.get(host) || null : null;
    })();
    const editable = term ? null : _editableOf(target);
    const selection = _selectedText(target, editable, term);
    const writable = editable && !editable.readOnly && !editable.disabled;
    const link = _linkOf(target);
    const list = [];

    if (writable && selection) list.push({ label: t('ctx_cut'), run: () => _cut(editable, selection) });
    if (selection) list.push({ label: t('ctx_copy'), run: () => _writeText(selection) });
    if (writable || term) list.push({ label: t('ctx_paste'), run: () => _pasteInto(editable, term) });
    if (term) list.push({ label: t('ctx_select_all'), run: () => { term.selectAll(); term.focus(); } });
    else if (editable) list.push({ label: t('ctx_select_all'), run: () => { editable.focus(); document.execCommand('selectAll'); } });
    if (link) {
      list.push('sep');
      list.push({ label: t('ctx_open_link'), run: () => window.open(link, '_blank', 'noopener') });
      list.push({ label: t('ctx_copy_link'), run: () => _writeText(link) });
    }
    list.push('sep');
    list.push({ label: '📋 ' + t('ctx_clip_paste'), run: () => (typeof ClipboardApp !== 'undefined' ? ClipboardApp.pasteFromSystem() : null) });
    list.push({ label: t('ctx_reload'), run: () => location.reload() });
    return list.filter((it, i, a) => it !== 'sep' || (i > 0 && a[i - 1] !== 'sep' && i < a.length - 1));
  }

  function close() {
    if (_menu) _menu.classList.remove('open');
  }

  function show(x, y, target) {
    if (!_menu) {
      _menu = document.createElement('div');
      _menu.id = 'os-ctx-menu';
      // Keep focus and the text selection where they are while the menu is used.
      _menu.addEventListener('mousedown', e => e.preventDefault());
      _menu.addEventListener('contextmenu', e => e.preventDefault());
      document.body.appendChild(_menu);
    }
    const items = _items(target);
    _menu.innerHTML = items.map((it, i) => it === 'sep'
      ? '<div class="ctx-sep"></div>'
      : `<div class="ctx-item" data-i="${i}">${esc(it.label)}</div>`).join('');
    _menu.onclick = e => {
      const row = e.target.closest('.ctx-item');
      if (!row) return;
      const item = items[Number(row.dataset.i)];
      close();
      if (item && item.run) item.run();
    };
    _menu.style.left = '0px';
    _menu.style.top = '0px';
    _menu.classList.add('open');
    const r = _menu.getBoundingClientRect();
    _menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    _menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  }

  document.addEventListener('contextmenu', e => {
    if (e.defaultPrevented) return;                       // someone showed their own menu
    if (e.shiftKey) { close(); return; }                  // Shift: the browser's menu
    if (window.innerWidth < 768) return;                  // phones keep native long-press
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest('[data-native-menu]')) return;
    e.preventDefault();
    show(e.clientX, e.clientY, target);
  });

  document.addEventListener('mousedown', e => { if (_menu && !_menu.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, true);
  document.addEventListener('scroll', close, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  return { close };
})();
