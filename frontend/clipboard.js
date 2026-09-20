/**
 * mvmOS Clipboard
 * A shelf for text and files that follows you between devices. Anything pasted,
 * dropped, typed or photographed is stored on the server for its owner and shows
 * up in the same list on the public page (/pub/clipboard/) and on every desktop.
 *
 * Capturing is global: Ctrl+V anywhere on the desktop, a file dragged in from
 * the computer, the "Paste to Clipboard" entry in the desktop menu, or the
 * taskbar button. Zones that already take dropped files themselves (the File
 * Manager list, an app's own drop area) keep priority — see the dragover check.
 */
const ClipboardApp = (() => {
  const API = '/pub/clipboard/api';
  const WIN_ID = 'clipboard';
  const SEEN_KEY = 'clipboard_seen_id';
  const INLINE_IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'];

  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let _body = null;                       // the open window's body, else null
  let _items = [];
  let _meta = { retention_hours: 24, max_file_bytes: 50 * 1024 * 1024 };
  let _latestId = 0;
  let _profile = null;                    // the Apps Hub profile this browser is signed in to
  let _queue = Promise.resolve();         // saves run one after another
  const _thumbs = new Map();              // item id -> object URL of its image

  function _headers(extra) {
    return window.mvmOS && mvmOS._pubHeaders
      ? mvmOS._pubHeaders(extra)
      : Object.assign({ 'X-Mvm-Surface': 'desktop' }, extra || {});
  }

  function _api(path, opts) {
    opts = opts || {};
    return fetch(API + path, Object.assign({}, opts, { headers: _headers(opts.headers) }));
  }

  function _toast(title, body) {
    if (window.mvmOS && mvmOS.toast) mvmOS.toast(title, body || '');
  }

  async function _errorText(res) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_) {}
    if (typeof detail === 'string' && detail.startsWith('clip_')) {
      return t(detail, { mb: Math.round(_meta.max_file_bytes / 1048576) });
    }
    return t('clip_error_generic');
  }

  // ── Signed-in profile ──────────────────────────────────────────────────
  // The desktop and every window in it share one Apps Hub sign-in (the token
  // lives in this browser), and it decides where new items are saved.
  async function _loadProfile() {
    try { _profile = typeof AppHub !== 'undefined' ? await AppHub.getUser() : null; }
    catch (_) { _profile = null; }
    _renderProfile();
  }

  function _renderProfile() {
    const el = _body && _body.querySelector('#clip-profile');
    if (!el) return;
    el.innerHTML = _profile
      ? `<span>👤 ${esc(t('clip_profile_in', { name: _profile.display_name || _profile.username }))}</span>`
      : `<span>${esc(t('clip_desktop_hint'))}</span><button class="s-btn s-btn-sm" id="clip-signin">${esc(t('clip_signin_btn'))}</button>`;
    const btn = el.querySelector('#clip-signin');
    if (btn) btn.addEventListener('click', () => {
      if (typeof AppHub !== 'undefined') AppHub.requireLogin(() => { _loadProfile(); refresh(); });
    });
  }

  // ── Seen marker for the taskbar dot ────────────────────────────────────
  function _seenId() {
    try { return parseInt(localStorage.getItem(SEEN_KEY) || '0', 10) || 0; } catch (_) { return 0; }
  }
  function _markSeen(id) {
    try { localStorage.setItem(SEEN_KEY, String(id)); } catch (_) {}
    _renderDot();
  }
  function _renderDot() {
    const dot = document.getElementById('clip-badge');
    if (dot) dot.style.display = _latestId > _seenId() && !_body ? '' : 'none';
  }

  async function _pollSummary() {
    if (document.hidden) return;
    try {
      const res = await _api('/summary');
      if (!res.ok) return;
      const d = await res.json();
      _latestId = d.latest_id || 0;
      if (_body) { _markSeen(_latestId); if (_items.length !== d.count || (_items[0] && _items[0].id !== _latestId)) refresh(); }
      else _renderDot();
    } catch (_) {}
  }

  // ── Saving ─────────────────────────────────────────────────────────────
  function _stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function _named(file) {
    // A pasted screenshot arrives as "image.png" every time.
    if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
    const ext = (file.type.split('/')[1] || 'png').split('+')[0].replace('jpeg', 'jpg');
    return new File([file], `screenshot-${_stamp()}.${ext}`, { type: file.type });
  }

  function _enqueue(task) {
    _queue = _queue.then(task, task);
    return _queue;
  }

  function _setStatus(text) {
    const el = _body && _body.querySelector('#clip-status');
    if (el) { el.textContent = text || ''; el.style.display = text ? '' : 'none'; }
  }

  async function saveText(text) {
    return _enqueue(async () => {
      try {
        const res = await _api('/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) { _toast(t('app_clipboard'), await _errorText(res)); return false; }
        const row = await res.json();
        _latestId = Math.max(_latestId, row.id);
        _markSeen(_latestId);
        _toast(t('clip_saved'), text.length > 80 ? text.slice(0, 80) + '…' : text);
        refresh();
        return true;
      } catch (_) { _toast(t('app_clipboard'), t('clip_error_generic')); return false; }
    });
  }

  async function saveFiles(files) {
    files = Array.from(files || []).map(_named);
    if (!files.length) return false;
    return _enqueue(async () => {
      let ok = 0;
      for (const file of files) {
        if (file.size > _meta.max_file_bytes) {
          _toast(file.name, t('clip_error_file_big', { mb: Math.round(_meta.max_file_bytes / 1048576) }));
          continue;
        }
        _setStatus(t('clip_uploading') + ' ' + file.name);
        try {
          const form = new FormData();
          form.append('file', file, file.name);
          const res = await _api('/file', { method: 'POST', body: form });
          if (!res.ok) { _toast(file.name, await _errorText(res)); continue; }
          const row = await res.json();
          _latestId = Math.max(_latestId, row.id);
          ok++;
        } catch (_) { _toast(file.name, t('clip_error_generic')); }
      }
      _setStatus('');
      if (ok) {
        _markSeen(_latestId);
        _toast(t('clip_saved'), files.length === 1 ? files[0].name : String(ok));
        refresh();
      }
      return ok > 0;
    });
  }

  // Reads the system clipboard on demand — the desktop menu and the Paste
  // button. Needs the browser's permission (and a secure page); when it is not
  // given, the person can still press Ctrl+V, which never needs one.
  async function pasteFromSystem() {
    const cb = navigator.clipboard;
    if (!cb || (!cb.read && !cb.readText)) return _blocked();
    try {
      if (cb.read) {
        const entries = await cb.read();
        const files = [];
        let text = null;
        for (const entry of entries) {
          const img = entry.types.find(x => x.startsWith('image/'));
          if (img) {
            const blob = await entry.getType(img);
            files.push(new File([blob], 'image.' + (img.split('/')[1] || 'png'), { type: img }));
          } else if (entry.types.includes('text/plain')) {
            text = await (await entry.getType('text/plain')).text();
          }
        }
        if (files.length) return saveFiles(files);
        if (text && text.trim()) return saveText(text);
      } else {
        const text = await cb.readText();
        if (text && text.trim()) return saveText(text);
      }
      _toast(t('app_clipboard'), t('clip_error_empty'));
    } catch (_) {
      _blocked();
    }
  }

  function _blocked() {
    openWindow();
    _toast(t('app_clipboard'), t('clip_paste_blocked'));
  }

  // ── Window ─────────────────────────────────────────────────────────────
  function _kindIcon(item) {
    if (item.kind === 'text') return '📝';
    const m = item.mime || '';
    if (m.startsWith('image/')) return '🖼️';
    if (m.startsWith('video/')) return '🎞️';
    if (m.startsWith('audio/')) return '🎵';
    if (m === 'application/pdf') return '📕';
    if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return '📦';
    if (m.startsWith('text/')) return '📄';
    return '📄';
  }

  function _size(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function _ago(iso) {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(window.mvmOS?.lang || undefined, { numeric: 'auto' });
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(Math.round(diff), 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }

  function _expiry(item) {
    if (item.pinned) return '📌 ' + t('clip_pinned');
    if (!item.expires_at) return '';
    const mins = Math.max(1, Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / 60000));
    return mins >= 60 ? t('clip_expires_h', { h: Math.ceil(mins / 60) }) : t('clip_expires_m', { m: mins });
  }

  function _isInlineImage(item) {
    return item.kind === 'file' && INLINE_IMAGES.includes((item.mime || '').toLowerCase());
  }

  function _rowHtml(item) {
    const title = item.kind === 'file'
      ? `<div class="clip-title">${esc(item.name)}</div>`
      : `<div class="clip-text" data-act="expand">${esc(item.text)}</div>`;
    const copyBtn = item.kind === 'text' || _isInlineImage(item)
      ? `<button class="s-btn s-btn-sm" data-act="copy">${esc(t('clip_copy'))}</button>` : '';
    const dl = item.kind === 'file' ? `<button class="s-btn s-btn-sm" data-act="download">${esc(t('clip_download'))}</button>` : '';
    const pathBtn = item.path ? `<button class="s-btn s-btn-sm" data-act="copypath" title="${esc(item.path)}">${esc(t('clip_copy_path'))}</button>` : '';
    return `<div class="clip-item" data-id="${item.id}">
      <div class="clip-thumb">${_isInlineImage(item) ? '<img alt="">' : _kindIcon(item)}</div>
      <div class="clip-main">
        ${title}
        <div class="clip-meta">${esc(item.kind === 'file' ? _size(item.size) + ' · ' : '')}${esc(_ago(item.created_at))}${_expiry(item) ? ' · ' + esc(_expiry(item)) : ''}</div>
        <div class="clip-actions">
          ${copyBtn}${pathBtn}${dl}
          <button class="s-btn s-btn-sm" data-act="pin">${esc(item.pinned ? t('clip_unpin') : t('clip_pin'))}</button>
          <button class="s-btn s-btn-sm s-btn-danger" data-act="delete">${esc(t('clip_delete'))}</button>
        </div>
      </div>
    </div>`;
  }

  async function _thumbUrl(item) {
    if (_thumbs.has(item.id)) return _thumbs.get(item.id);
    const res = await _api(`/items/${item.id}/file`);
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    _thumbs.set(item.id, url);
    return url;
  }

  function _render() {
    if (!_body) return;
    const list = _body.querySelector('#clip-list');
    if (!list) return;
    const alive = new Set(_items.map(i => i.id));
    for (const [id, url] of _thumbs) if (!alive.has(id)) { URL.revokeObjectURL(url); _thumbs.delete(id); }
    list.innerHTML = (_items.length ? _items.map(_rowHtml).join('') : `<div class="clip-empty">${esc(t('clip_empty'))}</div>`)
      + `<div class="clip-hint">${esc(t('clip_retention_note', { h: _meta.retention_hours }))}</div>`;
    _items.filter(_isInlineImage).forEach(async item => {
      const url = await _thumbUrl(item);
      const img = url && list.querySelector(`.clip-item[data-id="${item.id}"] img`);
      if (img) img.src = url;
    });
  }

  async function refresh() {
    if (!_body || !document.body.contains(_body)) { _body = null; return; }
    try {
      const res = await _api('/items');
      if (!res.ok) return;
      const d = await res.json();
      _items = d.items || [];
      _meta = { retention_hours: d.retention_hours, max_file_bytes: d.max_file_bytes };
      if (_items.length) { _latestId = Math.max(_latestId, _items[0].id); _markSeen(_latestId); }
      _render();
    } catch (_) {}
  }

  async function _copyItem(item) {
    try {
      if (item.kind === 'text') {
        await navigator.clipboard.writeText(item.text);
      } else {
        const res = await _api(`/items/${item.id}/file`);
        let blob = await res.blob();
        if (blob.type !== 'image/png') {
          const bmp = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width; canvas.height = bmp.height;
          canvas.getContext('2d').drawImage(bmp, 0, 0);
          blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
      _toast(t('clip_copied'), '');
    } catch (_) { _toast(t('app_clipboard'), t('clip_error_generic')); }
  }

  async function _download(item) {
    const res = await _api(`/items/${item.id}/file?download=1`);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = item.name || 'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function openWindow() {
    Desktop.createWindow({
      id: WIN_ID,
      title: '📋 ' + t('app_clipboard'),
      width: 480,
      height: 620,
      onMount(body) {
        _body = body;
        body.style.cssText = 'padding:0';
        const touch = navigator.maxTouchPoints > 0;
        body.innerHTML = `
          <div class="clip-root">
            <div class="clip-bar">
              <button class="s-btn s-btn-sm" id="clip-upload">⬆ ${esc(t('clip_upload'))}</button>
              ${touch ? `<button class="s-btn s-btn-sm" id="clip-camera">📷 ${esc(t('clip_camera'))}</button>` : ''}
              <button class="s-btn s-btn-sm" id="clip-paste">📋 ${esc(t('clip_paste'))}</button>
              <button class="s-btn s-btn-sm s-btn-danger clip-grow" id="clip-clear">${esc(t('clip_clear'))}</button>
              <input type="file" id="clip-file" multiple hidden>
              <input type="file" id="clip-cam" accept="image/*" capture="environment" hidden>
            </div>
            <div class="clip-profile" id="clip-profile"></div>
            <div class="clip-compose">
              <textarea class="s-input" id="clip-text" placeholder="${esc(t('clip_compose_ph'))}"></textarea>
              <button class="s-btn" id="clip-save">${esc(t('clip_save'))}</button>
            </div>
            <div class="clip-status" id="clip-status" style="display:none"></div>
            <div class="clip-list" id="clip-list"></div>
          </div>`;
        const $ = s => body.querySelector(s);
        $('#clip-upload').addEventListener('click', () => $('#clip-file').click());
        $('#clip-file').addEventListener('change', e => { saveFiles(e.target.files); e.target.value = ''; });
        $('#clip-camera')?.addEventListener('click', () => $('#clip-cam').click());
        $('#clip-cam').addEventListener('change', e => { saveFiles(e.target.files); e.target.value = ''; });
        $('#clip-paste').addEventListener('click', pasteFromSystem);
        const save = async () => {
          const box = $('#clip-text');
          if (!box.value.trim()) return;
          if (await saveText(box.value)) box.value = '';
        };
        $('#clip-save').addEventListener('click', save);
        $('#clip-text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
        $('#clip-clear').addEventListener('click', async () => {
          if (!confirm(t('clip_clear_confirm'))) return;
          await _api('/items', { method: 'DELETE' });
          refresh();
        });
        $('#clip-list').addEventListener('click', async e => {
          const btn = e.target.closest('[data-act]');
          const row = e.target.closest('.clip-item');
          if (!btn || !row) {
            if (e.target.matches('.clip-thumb img')) {
              const url = _thumbs.get(Number(e.target.closest('.clip-item').dataset.id));
              if (url) window.open(url, '_blank');
            }
            return;
          }
          const item = _items.find(i => i.id === Number(row.dataset.id));
          if (!item) return;
          switch (btn.dataset.act) {
            case 'expand': btn.classList.toggle('open'); break;
            case 'copy': _copyItem(item); break;
            case 'download': _download(item); break;
            case 'copypath':
              try { await navigator.clipboard.writeText(item.path); _toast(t('clip_copied'), item.path); }
              catch (_) { _toast(t('app_clipboard'), t('clip_error_generic')); }
              break;
            case 'pin':
              await _api(`/items/${item.id}/pin`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: !item.pinned }),
              });
              refresh();
              break;
            case 'delete':
              await _api(`/items/${item.id}`, { method: 'DELETE' });
              refresh();
              break;
          }
        });
        _renderDot();
        _loadProfile();
        refresh();
      },
    });
  }

  // ── Global capture ─────────────────────────────────────────────────────
  function _isEditable(el) {
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  document.addEventListener('paste', e => {
    if (e.defaultPrevented || !e.clipboardData) return;
    const target = e.target instanceof Element ? e.target : document.body;
    if (target.closest('[data-clip-ignore]')) return;
    // The File Manager's own Ctrl+V pastes files it copied, not the system's.
    const fmPaste = !!window._fmClipboard && !!target.closest('.window');
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) {
      // Even with a text box focused (a terminal, say): an image or file cannot
      // be typed into one, so there is no other meaning for the paste.
      if (fmPaste) return;
      e.preventDefault();
      saveFiles(files);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.trim() || _isEditable(target)) return;
    const win = target.closest('.window');
    if (win && win.dataset.winId !== WIN_ID) return;
    e.preventDefault();
    saveText(text);
  });

  let _hint = null;
  function _showHint(on) {
    if (!_hint) {
      _hint = document.createElement('div');
      _hint.id = 'clip-drop-hint';
      document.body.appendChild(_hint);
    }
    _hint.textContent = '📋 ' + t('clip_drop_hint');
    _hint.style.display = on ? 'block' : 'none';
  }
  const _hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  document.addEventListener('dragover', e => {
    if (!_hasFiles(e)) return;
    // Something nearer already claimed the drop (File Manager, an app's own
    // drop area) — leave it to them.
    if (e.defaultPrevented) { _showHint(false); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    _showHint(true);
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) _showHint(false); });
  document.addEventListener('dragend', () => _showHint(false));
  document.addEventListener('drop', e => {
    _showHint(false);
    if (!_hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const files = [];
    Array.from(e.dataTransfer.items || []).forEach(item => {
      if (item.kind !== 'file') return;
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry && entry.isDirectory) return;
      const f = item.getAsFile();
      if (f) files.push(f);
    });
    saveFiles(files);
  });

  // ── Taskbar and menus ──────────────────────────────────────────────────
  document.getElementById('clip-btn')?.addEventListener('click', () => openWindow());
  document.getElementById('ctx-clip-paste')?.addEventListener('click', () => {
    document.getElementById('context-menu')?.classList.remove('open');
    pasteFromSystem();
  });
  const _label = () => {
    const btn = document.getElementById('clip-btn');
    if (btn) { btn.title = t('app_clipboard'); btn.setAttribute('aria-label', t('app_clipboard')); }
  };
  window.addEventListener('i18n-loaded', _label);
  _label();
  window.addEventListener('apphub_login', () => { if (_body) { _loadProfile(); refresh(); } _pollSummary(); });
  window.addEventListener('focus', () => { _pollSummary(); if (_body) _loadProfile(); });
  setTimeout(_pollSummary, 2000);
  setInterval(_pollSummary, 30000);

  return { openWindow, saveText, saveFiles, pasteFromSystem, refresh };
})();
