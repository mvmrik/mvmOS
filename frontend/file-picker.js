// Shared file and folder picker, the counterpart of the shared calendar.
//
//   await mvmOS.filePicker.ready();
//   const result = await mvmOS.filePicker.open({
//     mode: 'files',                       // 'file' | 'files' | 'folder' | 'directory'
//     sources: ['device', 'server', 'shared'],
//     accept: ['.mp3', '.m4b', 'audio/*'],
//     server: {roots: ['~', '/srv/media'], start: '~'},   // hidden files: option hidden:true
//     shared: {ids: null, permission: 'read'},
//   });                                    // null when cancelled
//
// It only lets a person choose. Anything it returns must be validated again by
// the app's backend (backend/filepicker.py has the helpers): the options narrow
// what the window offers, they are not a security boundary.
//
// Result: {source, mode, files: [entry], folder?}
//   device entry: {name, size, relativePath, file}              (a File object)
//   server entry: {name, size, relativePath, path}              (absolute path)
//   shared entry: {name, size, relativePath, shared: {folderId, path, folderName}}
//   folder: {name, path} for the server, {name, shared: {folderId, path, folderName}}
//   for a shared folder; mode 'folder' also lists every matching file below it.
(function () {
  'use strict';
  window.mvmOS = window.mvmOS || {};
  if (window.mvmOS.filePicker) return;

  const PREFIX = '/pub/shared-files/v1/';
  const MODES = ['file', 'files', 'folder', 'directory'];
  const SOURCES = ['device', 'server', 'shared'];
  const EN = {
    title_file: 'Choose a file', title_files: 'Choose files', title_folder: 'Choose a folder', title_directory: 'Choose a location',
    where_files: 'Where are the files?', where_folder: 'Where is the folder?', where_directory: 'Where should it go?',
    src_device: 'This device', src_device_hint: 'Files on this computer, phone or tablet',
    src_server: 'mvmOS server', src_server_hint: 'Files stored on this server',
    src_shared: 'Shared folder', src_shared_hint: 'A folder shared from another mvmOS server',
    back: 'Back', close: 'Close', cancel: 'Cancel', select: 'Select', use_folder: 'Use this folder', use_here: 'Use this location',
    pick_file: 'Choose a file…', pick_files: 'Choose files…', pick_folder: 'Choose a folder…',
    drop_file: 'or drop a file here', drop_files: 'or drop files here', drop_folder: 'or drop a folder here',
    nothing_selected: 'Nothing selected yet', selected_n: '{count} selected', files_n: '{count} files', remove: 'Remove',
    home: 'Home', places: 'Places', up: 'Up one level', filter: 'Filter by name', loading: 'Loading…', empty: 'Nothing to choose here',
    no_match: 'No matching items', failed: 'This location could not be opened.', no_shared: 'No shared folders are connected yet.',
    no_read: 'This shared folder does not allow this.', scanning: 'Reading the folder… {count} files found',
    too_many: 'Too many files. At most {max} can be chosen.', too_large: '{name} is larger than {max}.',
    skipped_type: '{count} files were skipped because of their type.', skipped_size: '{count} files were skipped because they are too large.',
    only_types: 'Allowed types: {types}', folder_empty: 'This folder has no matching files.', open_folder: 'Open folder', total: 'Total',
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const lang = () => window.mvmOS.lang || document.documentElement.lang || 'en';
  const tr = (key, labels, vars) => {
    let text = (labels && labels[key]) || (window._i18n || {})['fpick_' + key] || EN[key] || key;
    for (const k in vars || {}) text = text.replace('{' + k + '}', vars[k]);
    return text;
  };
  const natural = (a, b) => String(a).localeCompare(String(b), lang(), {numeric: true, sensitivity: 'base'});
  function size(bytes) {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v >= 100 ? 0 : 1) : v) + ' ' + units[i];
  }
  const ext = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i).toLowerCase() : ''; };
  // Extension fallbacks let a type such as audio/* work for server and shared
  // files, which have no MIME type, and for device files that report none.
  const KINDS = {
    audio: '.mp3 .m4a .m4b .aac .ogg .oga .opus .flac .wav .weba .wma .aiff',
    video: '.mp4 .m4v .mov .webm .mkv .avi .ogv .mpg .mpeg',
    image: '.jpg .jpeg .png .gif .webp .bmp .svg .avif .heic .tif .tiff',
    text: '.txt .md .csv .log .json .xml .yaml .yml .html .css .js',
  };
  const icon = name => { const e = ext(name); for (const [kind, mark] of [['audio', '🎵'], ['video', '🎬'], ['image', '🖼️']]) if (KINDS[kind].split(' ').includes(e)) return mark; return '📄'; };
  function matcher(accept) {
    const list = (accept || []).map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (!list.length) return () => true;
    return (name, type) => {
      const e = ext(name), mime = String(type || '').toLowerCase();
      return list.some(rule => {
        if (rule.startsWith('.')) return e === rule;
        if (rule.endsWith('/*')) {
          const kind = rule.slice(0, -2);
          return mime ? mime.startsWith(kind + '/') : (KINDS[kind] || '').split(' ').includes(e);
        }
        return mime === rule;
      });
    };
  }
  const hiddenName = name => name.startsWith('.');

  // ---- sources ---------------------------------------------------------
  async function getJson(url) {
    const r = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
    if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).detail || r.statusText); e.status = r.status; throw e; }
    return r.json();
  }
  const clean = p => p.replace(/\/+$/, '') || '/';
  const join = (dir, name) => (dir === '/' ? '' : clean(dir)) + '/' + name;
  const within = (p, root) => p === root || p.startsWith(root === '/' ? '/' : root + '/');
  const parent = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };

  async function serverList(path, hidden) {
    const data = await getJson('/api/files?path=' + encodeURIComponent(path));
    return (data.entries || []).filter(e => e && typeof e.name === 'string' && (hidden || !hiddenName(e.name)))
      .map(e => ({name: e.name, type: e.type === 'dir' ? 'dir' : 'file', size: e.size || 0}));
  }
  async function remoteFolder(id) { return getJson('/api/files/remote-folders/' + encodeURIComponent(id)); }
  async function remote(folder, suffix, method = 'GET', data) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
    try {
      const r = await fetch(folder.origin + PREFIX + folder.grant_id + suffix, {method, mode: 'cors', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: abort.signal,
        headers: {Authorization: 'Bearer ' + folder.secret, ...(data === undefined ? {} : {'Content-Type': 'application/json'})},
        body: data === undefined ? undefined : JSON.stringify(data)});
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || r.statusText);
      return body;
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') throw new Error(tr('failed'));
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function sharedList(folder, path, hidden, need) {
    const data = await remote(folder, '/list?path=' + encodeURIComponent(path));
    // A remote listing is untrusted input.
    if (!Array.isArray(data.entries) || !Array.isArray(data.permissions)) throw new Error(tr('failed'));
    if (need && !data.permissions.includes(need)) throw new Error(tr('no_read'));
    return data.entries.filter(e => e && typeof e.name === 'string' && e.name && e.name.length <= 255 && !/[\/\0]/.test(e.name) &&
      !['.', '..'].includes(e.name) && ['dir', 'file'].includes(e.type) && Number.isSafeInteger(e.size) && (hidden || !hiddenName(e.name)))
      .map(e => ({name: e.name, type: e.type, size: e.size}));
  }
  // A short-lived direct link to a file in a shared folder, for playing it
  // from the sharing server instead of copying it.
  async function sharedFileUrl(ref) {
    const folder = await remoteFolder(ref.folderId);
    const result = await remote(folder, '/ticket', 'POST', {path: ref.path});
    return folder.origin + PREFIX + folder.grant_id + '/file?ticket=' + encodeURIComponent(result.ticket);
  }

  // ---- styles ----------------------------------------------------------
  function styles() {
    if (document.getElementById('mvm-fpicker-style')) return;
    const s = document.createElement('style');
    s.id = 'mvm-fpicker-style';
    const A = 'var(--pub-accent,var(--accent,#60a5fa))', B = 'var(--pub-border,var(--border,#45475a))',
      F = 'var(--pub-fg,var(--text,#e6e9f2))', D = 'var(--pub-fg2,var(--text-dim,#9aa4bd))',
      S1 = 'var(--pub-surface1,var(--surface,#1b2133))', S2 = 'var(--pub-surface2,var(--surface2,#252d45))';
    s.textContent = `
.mvm-fp{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(720px,calc(100vw - 24px));height:min(620px,calc(100dvh - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid ${B};border-radius:20px;background:${S1};color:${F};font:14px system-ui,sans-serif;box-shadow:0 24px 90px #0008;overflow:hidden}
.mvm-fp[open]{display:flex;flex-direction:column}.mvm-fp *{box-sizing:border-box}.mvm-fp::backdrop{background:#0008}
.mvm-fp button,.mvm-fp input{font:inherit;color:inherit}.mvm-fp button{cursor:pointer}.mvm-fp button:disabled{opacity:.4;cursor:default}
.mvm-fp :focus-visible{outline:2px solid ${A};outline-offset:2px}
.mvm-fp-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid ${B}}
.mvm-fp-head h2{flex:1;margin:0;font-size:18px;overflow-wrap:anywhere}
.mvm-fp-icon{border:0;background:transparent;border-radius:8px;min-width:40px;min-height:40px;font-size:18px}.mvm-fp-icon:hover:not(:disabled){background:${S2}}
.mvm-fp-body{flex:1;min-height:0;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.mvm-fp-lead{margin:0;color:${D}}
.mvm-fp-sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.mvm-fp-source{display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;padding:18px;border:1px solid ${B};border-radius:16px;background:${S2}}
.mvm-fp-source:hover{border-color:${A}}.mvm-fp-source b{font-size:15px}.mvm-fp-source span{color:${D};font-size:12px;line-height:1.4}.mvm-fp-source i{font-style:normal;font-size:28px}
.mvm-fp-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:150px;padding:22px;border:2px dashed ${B};border-radius:16px;text-align:center;color:${D}}
.mvm-fp-drop[data-over=true]{border-color:${A};background:color-mix(in srgb,${A} 10%,transparent)}
.mvm-fp-btn{border:0;border-radius:10px;min-height:40px;padding:8px 14px;background:${S2}}.mvm-fp-btn:hover:not(:disabled){filter:brightness(1.12)}
.mvm-fp .mvm-fp-primary{background:${A};color:var(--mvm-fp-on-accent,var(--on-accent,#fff));font-weight:600}
.mvm-fp-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mvm-fp-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:2px;flex:1;min-width:0}
.mvm-fp-crumbs button{border:0;background:transparent;border-radius:8px;padding:6px 8px;min-height:36px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mvm-fp-crumbs button:hover:not(:disabled){background:${S2}}
.mvm-fp-crumbs button[aria-current=true]{font-weight:700;opacity:1}.mvm-fp-crumbs span{color:${D}}
.mvm-fp-filter{flex:0 1 180px;min-width:120px;min-height:38px;padding:6px 10px;border:1px solid ${B};border-radius:10px;background:${S2}}
.mvm-fp-list{display:flex;flex-direction:column;gap:2px;flex:1 0 auto;min-height:120px}
.mvm-fp-row{display:flex;align-items:center;gap:10px;min-height:46px;padding:6px 10px;border:0;border-radius:10px;background:transparent;text-align:left;width:100%}
.mvm-fp-row:hover{background:${S2}}.mvm-fp-row[aria-checked=true]{background:color-mix(in srgb,${A} 18%,${S1})}
.mvm-fp-row .mvm-fp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mvm-fp-row .mvm-fp-meta{color:${D};font-size:12px;white-space:nowrap}
.mvm-fp-check{width:20px;height:20px;border:2px solid ${D};border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:13px;line-height:1}
.mvm-fp-row[role=radio] .mvm-fp-check{border-radius:50%}.mvm-fp-row[aria-checked=true] .mvm-fp-check{background:${A};border-color:${A};color:var(--mvm-fp-on-accent,var(--on-accent,#fff))}
.mvm-fp-ico{width:22px;text-align:center;flex:none}
.mvm-fp-pick{border:1px solid ${B};background:transparent;border-radius:8px;min-height:32px;padding:4px 10px;font-size:12px}
.mvm-fp-note{color:${D};font-size:12px;line-height:1.5;margin:0}.mvm-fp-error{color:var(--pub-red,light-dark(#b42335,#fda4af));line-height:1.5;margin:0}
.mvm-fp-empty{margin:auto;text-align:center;color:${D};padding:30px 10px}
.mvm-fp-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid ${B}}
.mvm-fp-types{flex-basis:100%;margin:0;color:${D};font-size:12px;line-height:1.4}
.mvm-fp-sum{flex:1;min-width:140px;color:${D};font-size:12px}
.mvm-fp-places{display:flex;flex-wrap:wrap;gap:6px}
@media (max-width:520px){.mvm-fp{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0;border:0;margin:0}.mvm-fp-filter{flex-basis:100%}}
`;
    document.head.appendChild(s);
  }

  function ready() {
    // The calendar and the picker share the same display settings.
    return window.mvmOS.dateTimePicker?.ready ? window.mvmOS.dateTimePicker.ready() : Promise.resolve();
  }

  function normalize(options) {
    const o = {mode: 'file', sources: ['device'], accept: [], recursive: true, hidden: false, maxFiles: 1000, maxSize: 0, labels: null, ...options};
    if (!MODES.includes(o.mode)) throw new TypeError('Invalid picker mode');
    o.sources = [...new Set(o.sources)].filter(x => SOURCES.includes(x));
    if (o.mode === 'directory') o.sources = o.sources.filter(x => x !== 'device');
    o.server = {roots: ['~'], start: null, ...(o.server || {})};
    o.shared = {ids: null, permission: 'read', ...(o.shared || {})};
    o.accept = [].concat(o.accept || []);
    return o;
  }

  async function open(options = {}) {
    styles();
    await ready();
    const o = normalize(options);
    const L = (k, v) => tr(k, o.labels, v);
    const accepts = matcher(o.accept);
    const multi = o.mode === 'files';
    const picksFolder = o.mode === 'folder' || o.mode === 'directory';
    const need = o.shared.permission;
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'mvm-fp';
      dialog.setAttribute('aria-labelledby', 'mvm-fp-title');
      document.body.append(dialog);
      const abort = new AbortController();
      let probeData = null, view = 'source', source = null, selection = new Map(), deviceResult = null, message = '', busy = false;
      let browse = null;        // {root, path, folder, entries, filter, loading, error}
      let finished = false, loads = 0;

      const finish = value => {
        if (finished) return;
        finished = true;
        abort.abort();
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
      };
      dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dialog.addEventListener('keydown', e => e.stopPropagation());
      o.signal?.addEventListener('abort', () => finish(null), {once: true});

      const title = L('title_' + o.mode);
      const sourceInfo = {
        device: {icon: '💻', name: L('src_device'), hint: L('src_device_hint')},
        server: {icon: '🗄️', name: L('src_server'), hint: L('src_server_hint')},
        shared: {icon: '🌐', name: L('src_shared'), hint: L('src_shared_hint')},
      };
      const available = () => o.sources.filter(s => s === 'device' || (probeData && probeData[s]));

      function summary() {
        if (deviceResult && source === 'device') {
          const n = deviceResult.files.length, total = deviceResult.files.reduce((a, f) => a + f.size, 0);
          return n ? L('files_n', {count: n}) + ' · ' + size(total) : L('nothing_selected');
        }
        if (picksFolder) return browse?.folder || browse?.root ? '' : L('nothing_selected');
        const n = selection.size;
        return n ? L('selected_n', {count: n}) + ' · ' + size([...selection.values()].reduce((a, f) => a + f.size, 0)) : L('nothing_selected');
      }
      function canConfirm() {
        if (busy) return false;
        if (source === 'device') return !!deviceResult && deviceResult.files.length > 0;
        if (view !== 'browse' || !browse) return false;
        if (picksFolder) return !!(browse.path !== null && (browse.folder || browse.root));
        return selection.size > 0;
      }

      // ---- rendering -----------------------------------------------------
      function shell(inner, {back = false, confirm = true, confirmLabel} = {}) {
        dialog.innerHTML = `<div class="mvm-fp-head">${back ? `<button type="button" class="mvm-fp-icon" data-back aria-label="${esc(L('back'))}">←</button>` : ''}<h2 id="mvm-fp-title">${esc(title)}</h2><button type="button" class="mvm-fp-icon" data-close aria-label="${esc(L('close'))}">✕</button></div>
<div class="mvm-fp-body">${inner}</div>
<div class="mvm-fp-foot">${o.accept.length ? `<p class="mvm-fp-types">${esc(L('only_types', {types: o.accept.join(', ')}))}</p>` : ''}<span class="mvm-fp-sum" role="status">${esc(summary())}</span><button type="button" class="mvm-fp-btn" data-cancel>${esc(L('cancel'))}</button>${confirm ? `<button type="button" class="mvm-fp-btn mvm-fp-primary" data-confirm ${canConfirm() ? '' : 'disabled'}>${esc(confirmLabel || L(picksFolder ? (o.mode === 'directory' ? 'use_here' : 'use_folder') : 'select'))}</button>` : ''}</div>`;
        dialog.querySelector('[data-close]').onclick = dialog.querySelector('[data-cancel]').onclick = () => finish(null);
        const backButton = dialog.querySelector('[data-back]');
        if (backButton) backButton.onclick = goBack;
        const ok = dialog.querySelector('[data-confirm]');
        if (ok) ok.onclick = confirm_;
      }
      function goBack() {
        if (busy) return;
        message = '';
        // Inside a place or shared folder: first back to the list of places.
        const places = source === 'server' ? browse?.roots?.length > 1 && browse.root : source === 'shared' ? browse?.folders?.length > 1 && browse.folder : false;
        if (view === 'browse' && places) {
          selection = new Map();
          if (source === 'server') browse.root = null; else browse.folder = null;
          browse.path = null; browse.entries = []; browse.error = '';
          render(); return;
        }
        selection = new Map(); deviceResult = null; browse = null; view = 'source';
        render();
      }

      function renderSources() {
        const list = available();
        const lead = L('where_' + (o.mode === 'folder' ? 'folder' : o.mode === 'directory' ? 'directory' : 'files'));
        shell(`<p class="mvm-fp-lead">${esc(lead)}</p><div class="mvm-fp-sources">${list.map(s => `<button type="button" class="mvm-fp-source" data-source="${s}"><i aria-hidden="true">${sourceInfo[s].icon}</i><b>${esc(sourceInfo[s].name)}</b><span>${esc(sourceInfo[s].hint)}</span></button>`).join('')}</div>`, {confirm: false});
        dialog.querySelectorAll('[data-source]').forEach(b => { b.onclick = () => chooseSource(b.dataset.source); });
        dialog.querySelector('[data-source]')?.focus();
      }

      function renderDevice() {
        const files = deviceResult?.files || [];
        const label = L(o.mode === 'folder' ? 'pick_folder' : multi ? 'pick_files' : 'pick_file');
        const drop = L(o.mode === 'folder' ? 'drop_folder' : multi ? 'drop_files' : 'drop_file');
        const rows = files.slice(0, 200).map((f, i) => `<div class="mvm-fp-row" role="listitem"><span class="mvm-fp-ico" aria-hidden="true">${icon(f.name)}</span><span class="mvm-fp-name" title="${esc(f.relativePath)}">${esc(f.relativePath)}</span><span class="mvm-fp-meta">${esc(size(f.size))}</span>${o.mode === 'folder' ? '' : `<button type="button" class="mvm-fp-pick" data-remove="${i}" aria-label="${esc(L('remove') + ': ' + f.name)}">✕</button>`}</div>`).join('');
        shell(`<div class="mvm-fp-drop" data-drop><button type="button" class="mvm-fp-btn mvm-fp-primary" data-native>${esc(label)}</button><span>${esc(drop)}</span></div>${message ? `<p class="mvm-fp-error" role="alert">${esc(message)}</p>` : ''}${files.length ? `<div class="mvm-fp-list" role="list">${rows}</div>${files.length > 200 ? `<p class="mvm-fp-note">… ${files.length - 200}</p>` : ''}` : ''}`, {back: available().length > 1});
        const zone = dialog.querySelector('[data-drop]');
        dialog.querySelector('[data-native]').onclick = nativeChoose;
        zone.ondragover = e => { e.preventDefault(); zone.dataset.over = 'true'; };
        zone.ondragleave = () => { zone.dataset.over = 'false'; };
        zone.ondrop = async e => { e.preventDefault(); zone.dataset.over = 'false'; await dropped(e.dataTransfer); };
        dialog.querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => { deviceResult.files.splice(+b.dataset.remove, 1); render(); }; });
        dialog.querySelector('[data-native]').focus();
      }

      function takeDevice(list) {
        // list: [{file, relativePath}] from the native chooser or a drop.
        let wrongType = 0, tooLarge = 0;
        const out = [];
        for (const {file, relativePath} of list) {
          if (!o.hidden && relativePath.split('/').slice(1).some(hiddenName)) continue;
          if (!o.hidden && !relativePath.includes('/') && hiddenName(file.name) && o.mode === 'folder') continue;
          if (!accepts(file.name, file.type)) { wrongType++; continue; }
          if (o.maxSize && file.size > o.maxSize) { tooLarge++; continue; }
          out.push({name: file.name, size: file.size, relativePath, file});
        }
        out.sort((a, b) => natural(a.relativePath, b.relativePath));
        const notes = [];
        if (wrongType) notes.push(L('skipped_type', {count: wrongType}));
        if (tooLarge) notes.push(L('skipped_size', {count: tooLarge}));
        if (out.length > o.maxFiles) { notes.push(L('too_many', {max: o.maxFiles})); out.length = 0; }
        if (!multi && o.mode === 'file' && out.length > 1) out.length = 1;
        if (multi && deviceResult?.files.length && o.mode === 'files') {
          const have = new Set(deviceResult.files.map(f => f.relativePath + '|' + f.size));
          const merged = deviceResult.files.concat(out.filter(f => !have.has(f.relativePath + '|' + f.size)));
          if (merged.length > o.maxFiles) { notes.push(L('too_many', {max: o.maxFiles})); } else out.splice(0, out.length, ...merged);
        }
        const folderName = o.mode === 'folder' && out[0] ? out[0].relativePath.split('/')[0] : '';
        deviceResult = {files: out, folder: folderName ? {name: folderName} : null};
        if (o.mode === 'folder' && !out.length && !notes.length) notes.push(L('folder_empty'));
        message = notes.join(' ');
        render();
      }
      function nativeChoose() {
        const input = document.createElement('input');
        input.type = 'file';
        if (o.accept.length) input.accept = o.accept.join(',');
        if (multi) input.multiple = true;
        if (o.mode === 'folder') input.webkitdirectory = true;
        input.onchange = () => takeDevice([...input.files].map(file => ({file, relativePath: file.webkitRelativePath || file.name})));
        input.click();
      }
      async function dropped(transfer) {
        const items = [...(transfer.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
        const out = [];
        const walk = async (entry, prefix) => {
          if (entry.isFile) {
            const file = await new Promise((ok, no) => entry.file(ok, no));
            out.push({file, relativePath: prefix + entry.name});
          } else if (entry.isDirectory && o.mode === 'folder') {
            const reader = entry.createReader();
            for (;;) {
              const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
              if (!batch.length) break;
              for (const child of batch) { if (out.length > o.maxFiles * 2) return; await walk(child, prefix + entry.name + '/'); }
            }
          }
        };
        try {
          if (items.length) for (const entry of items) await walk(entry, '');
          else for (const file of transfer.files) out.push({file, relativePath: file.name});
        } catch (_) { message = L('failed'); }
        if (o.mode === 'folder' && !items.some(e => e.isDirectory)) { message = L('folder_empty'); render(); return; }
        takeDevice(out);
      }

      // ---- server and shared browsing -------------------------------------
      const keyOf = entryPath => entryPath;
      const pathFor = name => source === 'server' ? join(browse.path, name) : (browse.path ? browse.path + '/' + name : name);
      function entryFor(e) {
        const path = pathFor(e.name);
        if (source === 'server') return {name: e.name, size: e.size, relativePath: e.name, path};
        return {name: e.name, size: e.size, relativePath: e.name, shared: {folderId: browse.folder.id, path, folderName: browse.folder.name}};
      }
      async function load(path) {
        // Show the target while it loads; a failed folder stays open and empty so
        // the breadcrumbs still lead back.
        browse.path = path; browse.entries = []; browse.filter = ''; browse.loading = true; browse.error = ''; render();
        const mine = ++loads;
        try {
          const entries = source === 'server' ? await serverList(path, o.hidden) : await sharedList(browse.folder, path, o.hidden, need);
          if (finished || mine !== loads) return;
          browse.entries = entries;
        } catch (error) {
          if (finished || mine !== loads) return;
          browse.error = error.message || L('failed');
        }
        browse.loading = false; render();
      }
      async function chooseSource(next) {
        source = next; selection = new Map(); message = ''; deviceResult = null; browse = null;
        if (next === 'device') { view = 'device'; render(); return; }
        view = 'browse';
        if (next === 'server') {
          const home = probeData.server.home;
          const roots = o.server.roots.map(r => r === '~' ? home : r.startsWith('~/') ? clean(join(home, r.slice(2))) : clean(r));
          browse = {roots, root: roots.length === 1 ? roots[0] : null, path: null, entries: [], loading: false, error: '', filter: ''};
          // A start folder opens directly inside the most specific root that holds it.
          const start = o.server.start === null || o.server.start === undefined ? null : (o.server.start === '~' ? home : clean(o.server.start));
          const holder = start && roots.filter(r => within(start, r)).sort((x, y) => y.length - x.length)[0];
          if (holder) { browse.root = holder; await load(start); if (browse.error) { browse.error = ''; await load(holder); } }
          else if (browse.root) await load(browse.root);
          else render();
        } else {
          browse = {folders: probeData.shared, folder: null, path: null, entries: [], loading: false, error: '', filter: ''};
          if (browse.folders.length === 1) await openShared(browse.folders[0]); else render();
        }
      }
      async function openShared(folder) {
        browse.loading = true; render();
        try { browse.folder = {...(await remoteFolder(folder.id))}; }
        catch (error) { browse.loading = false; browse.error = error.message || L('failed'); render(); return; }
        browse.path = ''; await load('');
      }
      function crumbs() {
        if (source === 'server') {
          const rel = browse.path === browse.root ? '' : browse.path.slice(browse.root === '/' ? 1 : browse.root.length + 1);
          const rootLabel = browse.root === probeData.server.home ? L('home') : (browse.root === '/' ? '/' : browse.root.split('/').pop());
          const list = [{label: rootLabel, path: browse.root}];
          let acc = browse.root;
          for (const part of rel ? rel.split('/') : []) { acc = join(acc, part); list.push({label: part, path: acc}); }
          return list;
        }
        const list = [{label: browse.folder.name, path: ''}];
        let acc = '';
        for (const part of browse.path ? browse.path.split('/') : []) { acc = acc ? acc + '/' + part : part; list.push({label: part, path: acc}); }
        return list;
      }
      function renderBrowse() {
        const showingPlaces = source === 'server' ? !browse.root : !browse.folder;
        const back = available().length > 1 || (source === 'server' ? !!browse.root && browse.roots.length > 1 : !!browse.folder && browse.folders.length > 1);
        if (showingPlaces) {
          let rows;
          if (source === 'server') rows = browse.roots.map(r => `<button type="button" class="mvm-fp-row" data-root="${esc(r)}"><span class="mvm-fp-ico" aria-hidden="true">${r === probeData.server.home ? '🏠' : '📁'}</span><span class="mvm-fp-name">${esc(r === probeData.server.home ? L('home') : r)}</span><span class="mvm-fp-meta">${r === probeData.server.home ? esc(r) : ''}</span></button>`).join('');
          else rows = browse.folders.length ? browse.folders.map(f => `<button type="button" class="mvm-fp-row" data-shared="${esc(f.id)}"><span class="mvm-fp-ico" aria-hidden="true">🌐</span><span class="mvm-fp-name">${esc(f.name)}</span><span class="mvm-fp-meta">${esc(f.origin.replace(/^https?:\/\//, ''))}</span></button>`).join('') : `<p class="mvm-fp-empty">${esc(L('no_shared'))}</p>`;
          shell(`${browse.error ? `<p class="mvm-fp-error" role="alert">${esc(browse.error)}</p>` : ''}${browse.loading ? `<p class="mvm-fp-empty">${esc(L('loading'))}</p>` : ''}<div class="mvm-fp-list">${rows}</div>`, {back, confirm: false});
          dialog.querySelectorAll('[data-root]').forEach(b => { b.onclick = () => { browse.root = b.dataset.root; load(browse.root); }; });
          dialog.querySelectorAll('[data-shared]').forEach(b => { b.onclick = () => openShared(browse.folders.find(f => f.id === b.dataset.shared)); });
          return;
        }
        const needle = (browse.filter || '').toLowerCase();
        const folders = browse.entries.filter(e => e.type === 'dir');
        const files = picksFolder ? [] : browse.entries.filter(e => e.type === 'file' && accepts(e.name) && (!o.maxSize || e.size <= o.maxSize));
        const visible = [...folders, ...files].filter(e => !needle || e.name.toLowerCase().includes(needle)).sort((a, b) => (a.type === b.type ? natural(a.name, b.name) : a.type === 'dir' ? -1 : 1));
        const parts = crumbs();
        const rows = visible.map(e => {
          if (e.type === 'dir') return `<div class="mvm-fp-row" role="listitem" style="padding:0"><button type="button" class="mvm-fp-row" data-open="${esc(e.name)}" aria-label="${esc(L('open_folder') + ': ' + e.name)}"><span class="mvm-fp-ico" aria-hidden="true">📁</span><span class="mvm-fp-name">${esc(e.name)}</span></button>${picksFolder ? `<button type="button" class="mvm-fp-pick" data-use="${esc(e.name)}" style="margin-right:8px">${esc(L('select'))}</button>` : ''}</div>`;
          const key = keyOf(pathFor(e.name)), on = selection.has(key);
          return `<button type="button" class="mvm-fp-row" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" data-file="${esc(e.name)}"><span class="mvm-fp-check" aria-hidden="true">${on ? '✓' : ''}</span><span class="mvm-fp-ico" aria-hidden="true">${icon(e.name)}</span><span class="mvm-fp-name" title="${esc(e.name)}">${esc(e.name)}</span><span class="mvm-fp-meta">${esc(size(e.size))}</span></button>`;
        }).join('');
        const empty = browse.loading ? L('loading') : visible.length ? '' : (browse.entries.length && needle ? L('no_match') : L('empty'));
        shell(`<div class="mvm-fp-bar"><button type="button" class="mvm-fp-pick" data-up aria-label="${esc(L('up'))}" ${browse.path === (source === 'server' ? browse.root : '') ? 'disabled' : ''}>↑</button><div class="mvm-fp-crumbs" role="navigation">${parts.map((c, i) => `${i ? '<span aria-hidden="true">›</span>' : ''}<button type="button" data-crumb="${esc(c.path)}" ${i === parts.length - 1 ? 'aria-current="true"' : ''}>${esc(c.label)}</button>`).join('')}</div><input class="mvm-fp-filter" type="search" data-filter placeholder="${esc(L('filter'))}" aria-label="${esc(L('filter'))}" value="${esc(browse.filter || '')}"></div>${browse.error ? `<p class="mvm-fp-error" role="alert">${esc(browse.error)}</p>` : ''}<div class="mvm-fp-list" ${multi ? 'role="group"' : 'role="radiogroup"'}>${rows}${empty ? `<p class="mvm-fp-empty">${esc(empty)}</p>` : ''}</div>${message ? `<p class="mvm-fp-note" role="status">${esc(message)}</p>` : ''}`, {back});
        const go = path => { message = ''; load(path); };
        dialog.querySelector('[data-up]').onclick = () => go(source === 'server' ? parent(browse.path) : browse.path.split('/').slice(0, -1).join('/'));
        dialog.querySelectorAll('[data-crumb]').forEach(b => { b.onclick = () => go(b.dataset.crumb); });
        dialog.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => go(pathFor(b.dataset.open)); });
        dialog.querySelectorAll('[data-use]').forEach(b => { b.onclick = () => finishFolder(folders.find(f => f.name === b.dataset.use)); });
        dialog.querySelectorAll('[data-file]').forEach(b => {
          b.onclick = () => {
            const e = files.find(f => f.name === b.dataset.file), key = keyOf(pathFor(e.name));
            if (!multi) selection = new Map([[key, entryFor(e)]]);
            else if (selection.has(key)) selection.delete(key);
            else if (selection.size >= o.maxFiles) { message = L('too_many', {max: o.maxFiles}); }
            else selection.set(key, entryFor(e));
            if (multi && message && selection.size < o.maxFiles) message = '';
            render(); dialog.querySelector(`[data-file="${CSS.escape(e.name)}"]`)?.focus();
          };
          b.ondblclick = () => { if (!multi) confirm_(); };
        });
        const filter = dialog.querySelector('[data-filter]');
        filter.oninput = () => { browse.filter = filter.value; const pos = filter.selectionStart; render(); const n = dialog.querySelector('[data-filter]'); n.focus(); n.setSelectionRange(pos, pos); };
      }

      // ---- finishing --------------------------------------------------------
      async function scan(folderEntry) {
        // Walk a server or shared folder, collecting the files that match.
        const base = folderEntry;
        const out = []; let wrongType = 0, tooLarge = 0, queue = [{path: base.path, rel: base.name}];
        const readDir = p => source === 'server' ? serverList(p, o.hidden) : sharedList(browse.folder, p, o.hidden, need);
        let depth = 0;
        while (queue.length && !abort.signal.aborted) {
          if (++depth > 20000) break;
          const {path, rel} = queue.shift();
          if (rel.split('/').length > 33) continue;
          const list = await readDir(path);
          for (const e of list) {
            if (e.type === 'dir') { if (o.recursive) queue.push({path: source === 'server' ? join(path, e.name) : (path ? path + '/' + e.name : e.name), rel: rel + '/' + e.name}); continue; }
            if (!accepts(e.name)) { wrongType++; continue; }
            if (o.maxSize && e.size > o.maxSize) { tooLarge++; continue; }
            const full = source === 'server' ? join(path, e.name) : (path ? path + '/' + e.name : e.name);
            out.push(source === 'server' ? {name: e.name, size: e.size, relativePath: rel + '/' + e.name, path: full}
              : {name: e.name, size: e.size, relativePath: rel + '/' + e.name, shared: {folderId: browse.folder.id, path: full, folderName: browse.folder.name}});
            if (out.length > o.maxFiles) throw new Error(L('too_many', {max: o.maxFiles}));
          }
          message = L('scanning', {count: out.length}); render();
        }
        out.sort((a, b) => natural(a.relativePath, b.relativePath));
        return {files: out, wrongType, tooLarge};
      }
      async function finishFolder(entry) {
        // entry: a child folder row, or undefined for the folder being viewed.
        const here = source === 'server' ? {name: browse.path === '/' ? '/' : browse.path.split('/').pop(), path: browse.path}
          : {name: browse.path ? browse.path.split('/').pop() : browse.folder.name, path: browse.path};
        const target = entry ? {name: entry.name, path: pathFor(entry.name)} : here;
        const folder = source === 'server' ? {name: target.name, path: target.path}
          : {name: target.name, shared: {folderId: browse.folder.id, path: target.path, folderName: browse.folder.name}};
        if (o.mode === 'directory') { finish({source, mode: o.mode, files: [], folder}); return; }
        busy = true; render();
        try {
          const result = await scan({name: target.name, path: target.path});
          if (finished) return;
          busy = false;
          if (!result.files.length) { message = L('folder_empty'); render(); return; }
          finish({source, mode: o.mode, files: result.files, folder});
        } catch (error) {
          busy = false; message = error.message || L('failed'); render();
        }
      }
      function confirm_() {
        if (!canConfirm()) return;
        if (source === 'device') {
          finish({source, mode: o.mode, files: deviceResult.files, ...(deviceResult.folder ? {folder: deviceResult.folder} : {})});
        } else if (picksFolder) finishFolder(null);
        else finish({source, mode: o.mode, files: [...selection.values()]});
      }

      function render() {
        if (finished) return;
        if (view === 'source') renderSources();
        else if (view === 'device') renderDevice();
        else renderBrowse();
        if (busy) dialog.querySelectorAll('button:not([data-cancel]):not([data-close])').forEach(b => { b.disabled = true; });
      }

      // The accent button needs readable text whatever the page's accent is.
      function accentText() {
        const rgb = c => (String(c).match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
        const bg = rgb(getComputedStyle(dialog).backgroundColor);
        dialog.style.colorScheme = (bg[0] * .299 + bg[1] * .587 + bg[2] * .114) > 140 ? 'light' : 'dark';
        const probe = document.createElement('i'); probe.style.color = getComputedStyle(dialog).getPropertyValue('--pub-accent') || getComputedStyle(dialog).getPropertyValue('--accent') || '#60a5fa';
        probe.style.display = 'none'; dialog.append(probe);
        const accent = rgb(getComputedStyle(probe).color); probe.remove();
        const lum = accent.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        dialog.style.setProperty('--mvm-fp-on-accent', (1.05 / (lum + .05)) >= ((lum + .05) / .05) ? '#fff' : '#000');
      }

      (async () => {
        // Choose where files come from only after finding what this page may reach.
        probeData = {};
        const jobs = [];
        if (o.sources.includes('server')) jobs.push(getJson('/api/files/places').then(d => { if (d && d.home) probeData.server = d; }).catch(() => {}));
        if (o.sources.includes('shared')) jobs.push(getJson('/api/files/sharing').then(d => {
          const ids = o.shared.ids;
          const list = (d.incoming || []).filter(f => !ids || ids.includes(f.id));
          if (list.length || !ids) probeData.shared = list;
        }).catch(() => {}));
        await Promise.all(jobs);
        if (finished) return;
        dialog.showModal(); accentText();
        const list = available();
        if (!list.length) { shell(`<p class="mvm-fp-empty">${esc(L('failed'))}</p>`, {confirm: false}); return; }
        if (list.length === 1) await chooseSource(list[0]); else render();
      })();
    });
  }

  function accepts(accept, name, type) { return matcher(accept)(name, type); }
  window.mvmOS.filePicker = {ready, open, sharedFileUrl, accepts, formatSize: size};
})();
