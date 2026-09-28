// ── File associations ────────────────────────────────────────────────────────
//
// Which app opens which kind of file, for File Manager and the desktop.
//
// The built-in handlers keep the order the double-click used to test them in,
// so with nothing chosen every file opens exactly as before. An installed app
// adds its own types by passing file_types (extensions without the dot) and an
// openFile(path) function to mvmOS.registerApp; a type no built-in handler
// knows then opens in that app. The user's own choices live in the
// file_assoc setting ({ext: handler id}) and win over both. A choice whose app
// is no longer installed is simply ignored, so uninstalling an app falls back
// to the default instead of leaving files that open with nothing.

const FileAssoc = (() => {
  const ARCHIVE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tar\.xz)$/i;

  // ctx: { adminKey, siblings, fetch, onChange } — fetch goes through the
  // caller's File Manager window so an administrator window stays root.
  const BUILTIN = [
    { id: 'link', icon: '🌐', name: () => t('fa_app_link'),
      exts: () => ['url'],
      open: async (p, c) => {
        const text = await (await c.fetch(`/api/files/raw?path=${encodeURIComponent(p)}`)).text();
        const m = text.match(/^URL=(.+)$/m);
        if (m) window.open(m[1].trim(), '_blank');
      } },
    { id: 'imageviewer', icon: '🖼️', name: () => t('fa_app_image'),
      exts: () => ImageViewer.exts,
      open: (p, c) => ImageViewer.openWindow(p, c.siblings || [], { adminKey: c.adminKey }) },
    { id: 'mediaplayer', icon: '🎬', name: () => t('fa_app_media'),
      exts: () => VideoPlayer.exts,
      open: (p, c) => VideoPlayer.openWindow(p, { adminKey: c.adminKey }) },
    { id: 'extract', icon: '🗜️', name: () => t('fa_app_extract'),
      exts: () => ['zip', 'tar', 'tar.gz', 'tgz', 'tar.bz2', 'tar.xz'],
      open: async (p, c) => {
        const r = await c.fetch('/api/files/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) });
        const res = await r.json().catch(() => ({}));
        if (res.ok && c.onChange) c.onChange();
      } },
    // The two editors can also open any other file on request ("Open with").
    { id: 'codeeditor', icon: '💻', name: () => t('fa_app_code'), any: true,
      exts: () => CodeEditor.exts,
      open: (p, c) => CodeEditor.openFile(p, { adminKey: c.adminKey }) },
    { id: 'texteditor', icon: '📝', name: () => t('fa_app_text'), any: true,
      exts: () => TextEditor.exts,
      open: (p, c) => TextEditor.openWindow(p, { adminKey: c.adminKey }) },
  ];

  let _map = null;       // the user's choices, {ext: handler id}
  let _loading = null;
  let _closeDialog = null; // the open "Open with…" dialog, one at a time

  function load() {
    if (_map) return Promise.resolve(_map);
    if (!_loading) {
      _loading = fetch('/api/settings').then(r => r.json())
        .then(s => { _map = (s && typeof s.file_assoc === 'object' && s.file_assoc) || {}; })
        .catch(() => { _map = {}; })
        .then(() => { _loading = null; return _map; });
    }
    return _loading;
  }

  async function save(map) {
    _map = map;
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { file_assoc: map } }),
    });
    window.dispatchEvent(new CustomEvent('file-assoc-changed', { detail: map }));
  }

  // "archive.tar.gz" -> "tar.gz", "photo.JPG" -> "jpg", "README" -> ""
  function extOf(name) {
    const n = String(name).toLowerCase();
    const m = n.match(/\.(tar\.(?:gz|bz2|xz))$/);
    if (m) return m[1];
    const i = n.lastIndexOf('.');
    return i > 0 ? n.slice(i + 1) : '';
  }

  function appHandlers() {
    return Object.values(mvmOS._apps || {})
      .filter(a => typeof a.openFile === 'function' && Array.isArray(a.file_types))
      .map(a => ({
        id: 'app:' + a.id, icon: a.icon || '📦', name: () => a.name || a.id,
        exts: () => a.file_types.map(e => String(e).toLowerCase().replace(/^\./, '')),
        open: (p, c) => a.openFile(p, { adminKey: c.adminKey }),
      }));
  }

  function all() { return [...BUILTIN, ...appHandlers()]; }

  function claims(h, ext) {
    // Files with no extension are plain text as far as the editors go.
    if (!ext) return h.id === 'texteditor';
    return h.exts().includes(ext);
  }

  // Every handler that can open this kind of file; with openWith also the
  // editors that open anything.
  function candidates(ext, openWith) {
    return all().filter(h => claims(h, ext) || (openWith && h.any));
  }

  // The handler the file opens with when nobody chose: built-ins first, in
  // their old order, then the apps.
  function builtinDefault(ext) {
    return all().find(h => claims(h, ext)) || null;
  }

  function handlerFor(ext) {
    const chosen = _map && _map[ext];
    if (chosen) {
      const h = candidates(ext, true).find(x => x.id === chosen);
      if (h) return h;
    }
    return builtinDefault(ext);
  }

  function ctxOf(ctx) {
    return { fetch: (u, o) => fetch(u, o), ...(ctx || {}) };
  }

  // Opens the file with its app; a type nothing claims asks with "Open with…".
  async function open(path, ctx) {
    await load();
    const h = handlerFor(extOf(path.split('/').pop()));
    if (!h) return openWith(path, ctx);
    h.open(path, ctxOf(ctx));
  }

  // "Open with…": pick an app, and optionally keep it for this type.
  async function openWith(path, ctx) {
    await load();
    const name = path.split('/').pop();
    const ext = extOf(name);
    const list = candidates(ext, true);
    const current = handlerFor(ext);
    const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    if (_closeDialog) _closeDialog();
    const ov = document.createElement('div');
    ov.className = 'fa-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,6px);padding:20px;max-width:380px;width:90%;box-shadow:var(--shadow)">
      <div style="font-size:1.05rem;font-weight:700;margin-bottom:4px">${esc(t('fa_open_with'))}</div>
      <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px;word-break:break-all">${esc(name)}</div>
      <div class="fa-list" style="display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow:auto">
        ${list.map((h, i) => `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:.88rem">
          <input type="radio" name="fa-h" value="${esc(h.id)}" ${(current ? current.id === h.id : i === 0) ? 'checked' : ''} style="accent-color:var(--accent)">
          <span>${esc(h.icon)}</span><span>${esc(h.name())}</span></label>`).join('')}
      </div>
      ${ext ? `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.82rem;cursor:pointer">
        <input type="checkbox" class="fa-always" style="accent-color:var(--accent)"> ${esc(t('fa_always_use', { ext }))}</label>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="s-btn s-btn-sm fa-cancel">${esc(t('cancel'))}</button>
        <button class="s-btn s-btn-sm s-btn-primary fa-ok">${esc(t('fa_open'))}</button>
      </div></div>`;
    document.body.appendChild(ov);

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); if (_closeDialog === close) _closeDialog = null; };
    _closeDialog = close;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.querySelector('.fa-cancel').onclick = close;
    ov.querySelector('.fa-list').addEventListener('dblclick', e => { if (e.target.closest('label')) ov.querySelector('.fa-ok').click(); });
    ov.querySelector('.fa-ok').onclick = async () => {
      const id = ov.querySelector('input[name="fa-h"]:checked')?.value;
      const h = list.find(x => x.id === id);
      if (!h) return;
      const always = ov.querySelector('.fa-always')?.checked;
      close();
      if (always) await setDefault(ext, h.id);
      h.open(path, ctxOf(ctx));
    };
  }

  // Saving the built-in default again just drops the choice, so the type
  // follows the default if that ever changes.
  // ext may also be a list, to set several types in one save.
  async function setDefault(ext, id) {
    const map = { ...(await load()) };
    for (const e of [].concat(ext)) {
      const def = builtinDefault(e);
      if (!id || (def && def.id === id)) delete map[e];
      else map[e] = id;
    }
    await save(map);
  }

  async function resetAll() { await save({}); }

  // For Settings: one type with its choices, the handler in use and the
  // default; any extension, also one nothing claims yet.
  function rowOf(ext) {
    return {
      ext,
      candidates: candidates(ext, true).map(h => ({ id: h.id, icon: h.icon, name: h.name() })),
      current: handlerFor(ext)?.id || null,
      default: builtinDefault(ext)?.id || null,
      chosen: !!_map[ext],
    };
  }

  async function row(ext) {
    await load();
    return rowOf(String(ext).toLowerCase().replace(/^\.+/, ''));
  }

  // Every type something claims plus every type the user chose.
  async function table() {
    await load();
    const exts = new Set(Object.keys(_map));
    all().forEach(h => h.exts().forEach(e => exts.add(e)));
    return [...exts].filter(Boolean).sort().map(rowOf);
  }

  return { open, openWith, setDefault, resetAll, table, row, extOf, load };
})();
