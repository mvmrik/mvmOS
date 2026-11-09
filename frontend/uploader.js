// Shared uploader: one queue and one progress panel for every upload in mvmOS,
// the counterpart of the shared file picker. The picker only chooses; this sends.
//
//   // Ask what to upload and where, then send it:
//   const job = await mvmOS.uploader.choose({
//     mode: 'files',                         // 'file' | 'files' | 'folder'
//     accept: ['.torrent'],
//     destination: {sources: ['server', 'shared'], server: {roots: ['~'], start: '~/Downloads'}, rememberKey: 'myapp'},
//   });                                      // null when cancelled
//
//   // Or send something the app already has:
//   mvmOS.uploader.upload({
//     files: fileList,                       // File objects, or picker entries {file, relativePath}
//     destination: {type: 'server', path: '/home/me/Music'},
//     // {type: 'shared', folderId, path: 'Albums', name: 'Music'} for a folder shared from another mvmOS
//     extract: false,                        // unpack .zip/.tar archives on arrival (server only)
//     onDone(job) {}, onError(job) {}, onCancel(job) {},
//   });                                      // -> job {id, cancel(), retry(), state, ...}
//
// Files are cut into parts well under Cloudflare's 100 MB request limit. Server
// uploads go through /api/files/upload-chunk as the signed-in Linux user, so a
// person can never write more than File Manager lets them. Shared folders are
// written straight from this browser to the sharing server with the key the
// picker already uses, so the traffic never passes through this server.
// Jobs run one after another; every job shows in the panel and can be stopped.
(function () {
  'use strict';
  window.mvmOS = window.mvmOS || {};
  if (window.mvmOS.uploader) return;

  const SERVER_PART = 50 * 1024 * 1024;
  const SHARED_PREFIX = '/pub/shared-files/v1/';
  const EN = {
    title: 'Uploads', waiting: 'Waiting', uploading: 'Uploading', finishing: 'Finishing…', done: 'Done', failed: 'Failed',
    cancelled: 'Stopped', stop: 'Stop', retry: 'Try again', remove: 'Remove', clear: 'Clear finished', minimize: 'Minimize', expand: 'Show',
    files_n: '{count} files', to: 'To {dest}', choose_dest: 'Upload to…', n_failed: '{count} failed', n_done: '{count} of {total} files',
    leave: 'Uploads are still running.', network: 'The connection was lost.', unpacked: 'unpacked',
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const tr = (key, vars) => {
    let text = (window._i18n || {})['upl_' + key] || EN[key] || key;
    for (const k in vars || {}) text = text.replace('{' + k + '}', vars[k]);
    return text;
  };
  const fmtSize = bytes => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = bytes || 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v >= 100 ? 0 : 1) : v) + ' ' + units[i];
  };
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

  const jobs = [];
  let current = null, seq = 0, collapsed = false, panel = null, drawTimer = 0;

  // ---- transport -----------------------------------------------------------
  class Stopped extends Error {}
  // One request with upload progress. Aborting it is how a running job stops.
  function request(ctx, method, url, body, {headers = {}, json = false, onProgress, credentials = true} = {}) {
    return new Promise((resolve, reject) => {
      if (ctx.stopped) return reject(new Stopped());
      const xhr = new XMLHttpRequest();
      ctx.xhr = xhr;
      xhr.open(method, url);
      xhr.withCredentials = credentials;
      for (const k in headers) xhr.setRequestHeader(k, headers[k]);
      if (onProgress && xhr.upload) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = () => {
        ctx.xhr = null;
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 400) {
          const detail = typeof data.detail === 'string' ? data.detail : xhr.status === 413 ? 'The file is too large' : 'Error ' + xhr.status;
          return reject(Object.assign(new Error(detail), {status: xhr.status}));
        }
        resolve(data);
      };
      xhr.onerror = () => { ctx.xhr = null; reject(ctx.stopped ? new Stopped() : new Error(tr('network'))); };
      xhr.onabort = () => { ctx.xhr = null; reject(new Stopped()); };
      xhr.timeout = 0;
      xhr.send(json ? JSON.stringify(body) : body);
    });
  }

  async function sendToServer(job, ctx, item, progress) {
    const total = Math.max(1, Math.ceil(item.size / SERVER_PART));
    const uploadId = randomId();
    ctx.cleanup = () => fetch('/api/files/upload-chunk?upload_id=' + uploadId, {method: 'DELETE'}).catch(() => {});
    try {
      for (let i = 0; i < total; i++) {
        const fd = new FormData();
        fd.append('upload_id', uploadId);
        fd.append('chunk_index', i);
        fd.append('total_chunks', total);
        fd.append('filename', item.name);
        fd.append('path', job.dest.path);
        if (item.dir) fd.append('subdir', item.dir);
        if (job.extract) fd.append('extract', '1');
        fd.append('file', item.file.slice(i * SERVER_PART, Math.min(item.size, (i + 1) * SERVER_PART)), item.name);
        const base = i * SERVER_PART;
        if (i === total - 1) job.finishing = true;
        await request(ctx, 'POST', '/api/files/upload-chunk', fd, {onProgress: loaded => progress(base + loaded)});
        progress(Math.min(item.size, (i + 1) * SERVER_PART));
      }
    } finally { job.finishing = false; }
    ctx.cleanup = null;
  }

  async function sharedAccess(job) {
    if (job.folder) return job.folder;
    const r = await fetch('/api/files/remote-folders/' + encodeURIComponent(job.dest.folderId), {credentials: 'same-origin', cache: 'no-store'});
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Shared folder not found');
    job.folder = await r.json();
    return job.folder;
  }
  const joinRel = (...parts) => parts.filter(Boolean).join('/');

  async function sendToShared(job, ctx, item, progress) {
    const folder = await sharedAccess(job);
    const base = folder.origin + SHARED_PREFIX + folder.grant_id;
    const auth = {Authorization: 'Bearer ' + folder.secret};
    const req = (method, url, body, extra) => request(ctx, method, base + url, body, {credentials: false, json: !(body instanceof Blob), headers: {...auth, ...(body instanceof Blob ? {} : {'Content-Type': 'application/json'})}, ...extra});
    // Folders that came with the files are created first, one level at a time.
    let made = '';
    for (const part of item.dir ? item.dir.split('/') : []) {
      made = joinRel(made, part);
      const key = joinRel(job.dest.path, made);
      if (job.madeDirs.has(key)) continue;
      job.madeDirs.add(key);
      try { await req('POST', '/operations/mkdir', {path: key}); } catch (e) { if (e instanceof Stopped) throw e; /* usually exists already */ }
    }
    const start = await req('POST', '/uploads', {path: joinRel(job.dest.path, item.dir, item.name), size: item.size});
    ctx.cleanup = () => fetch(base + '/uploads/' + start.id, {method: 'DELETE', headers: auth, credentials: 'omit'}).catch(() => {});
    const part = Math.min(start.chunk_size || 4 * 1024 * 1024, SERVER_PART);
    let offset = 0;
    do {
      const end = Math.min(item.size, offset + part), at = offset;
      if (end >= item.size) job.finishing = true;
      await req('PUT', '/uploads/' + start.id, item.file.slice(at, end), {headers: {...auth, 'X-Upload-Offset': String(at)}, onProgress: loaded => progress(at + loaded)});
      progress(end);
      offset = end;
    } while (offset < item.size);
    job.finishing = false;
    ctx.cleanup = null;
  }

  // ---- running jobs --------------------------------------------------------
  function sample(job) {
    const now = performance.now(), sent = job.base + job.part;
    if (!job.mark) job.mark = {t: now, b: sent};
    if (now - job.mark.t >= 700) {
      const speed = (sent - job.mark.b) / ((now - job.mark.t) / 1000);
      job.speed = job.speed ? job.speed * 0.5 + speed * 0.5 : speed;
      job.mark = {t: now, b: sent};
    }
  }

  async function run(job) {
    current = job;
    job.state = 'uploading'; job.error = ''; job.speed = 0; job.mark = null; job.failed = [];
    const ctx = job.ctx = {stopped: false, xhr: null, cleanup: null};
    draw();
    const queue = job.pending; job.pending = [];
    try {
      for (const item of queue) {
        if (ctx.stopped) throw new Stopped();
        job.currentName = item.relative;
        job.part = 0;
        const progress = loaded => { job.part = Math.min(loaded, item.size); sample(job); draw(); };
        try {
          await (job.dest.type === 'shared' ? sendToShared : sendToServer)(job, ctx, item, progress);
          job.done++;
        } catch (error) {
          if (error instanceof Stopped || ctx.stopped) throw new Stopped();
          job.failed.push({item, message: error.message});
          if (ctx.cleanup) { ctx.cleanup(); ctx.cleanup = null; }
        }
        job.base += item.size; job.part = 0;
      }
      job.state = job.failed.length ? 'failed' : 'done';
      if (job.failed.length) job.error = job.failed[0].message;
    } catch (error) {
      if (!(error instanceof Stopped)) { job.state = 'failed'; job.error = error.message; }
      else {
        if (ctx.cleanup) ctx.cleanup();
        job.state = 'cancelled';
        // What was not sent can be sent again.
        job.pending = queue.filter(i => !job.failed.some(f => f.item === i)).slice(job.done + job.failed.length);
      }
    }
    job.speed = 0; job.finishing = false; job.ctx = null; current = null;
    try {
      if (job.state === 'done') job.onDone?.(job);
      else if (job.state === 'cancelled') job.onCancel?.(job);
      else job.onError?.(job);
    } catch (_) { /* an app callback must not stop the queue */ }
    draw(true);
    next();
  }
  function next() {
    if (current) return;
    const job = jobs.find(j => j.state === 'waiting');
    if (job) run(job);
  }

  // ---- public API ----------------------------------------------------------
  function entries(input) {
    const list = Array.isArray(input) ? input : (input && typeof input.length === 'number' && !(input instanceof File) ? [...input] : [input]);
    return list.filter(Boolean).map(e => {
      const file = e.file || e;
      const relative = String(e.relativePath || file.webkitRelativePath || file.name).replace(/^\/+/, '');
      const cut = relative.lastIndexOf('/');
      return {file, size: file.size, relative, name: relative.slice(cut + 1), dir: cut < 0 ? '' : relative.slice(0, cut)};
    });
  }
  function destinationLabel(d) {
    if (d.label) return d.label;
    if (d.type === 'shared') return (d.name || 'Shared folder') + (d.path ? '/' + d.path : '');
    return d.path;
  }
  function upload(options) {
    const d = options.destination || {};
    if (!['server', 'shared'].includes(d.type)) throw new TypeError('destination.type must be "server" or "shared"');
    if (d.type === 'server' && !d.path) throw new TypeError('A server destination needs a path');
    const items = entries(options.files);
    if (!items.length) throw new TypeError('Nothing to upload');
    const job = {
      id: ++seq, state: 'waiting', dest: {...d, path: d.path || ''}, destLabel: destinationLabel(d), extract: !!options.extract && d.type === 'server',
      items, pending: items.slice(), total: items.reduce((a, i) => a + i.size, 0), base: 0, part: 0, done: 0, failed: [], speed: 0, error: '',
      madeDirs: new Set(), folder: null, ctx: null, label: options.label || (items.length === 1 ? items[0].relative : tr('files_n', {count: items.length})),
      onDone: options.onDone, onError: options.onError, onCancel: options.onCancel,
      cancel() { cancel(job); }, retry() { retry(job); },
    };
    jobs.push(job);
    collapsed = false;
    draw(true);
    next();
    return job;
  }
  function cancel(job) {
    if (job.state === 'waiting') { job.state = 'cancelled'; job.onCancel?.(job); draw(true); return; }
    if (job.state !== 'uploading' || !job.ctx) return;
    job.ctx.stopped = true;
    job.ctx.xhr?.abort();
  }
  function retry(job) {
    if (!['failed', 'cancelled'].includes(job.state)) return;
    const again = job.state === 'failed' ? job.failed.map(f => f.item) : job.pending;
    if (!again.length) return;
    job.pending = again; job.items = again; job.total = again.reduce((a, i) => a + i.size, 0);
    job.base = 0; job.part = 0; job.done = 0; job.failed = []; job.error = ''; job.state = 'waiting';
    draw(true); next();
  }
  function remove(job) {
    if (job.state === 'uploading') return;
    const i = jobs.indexOf(job);
    if (i >= 0) jobs.splice(i, 1);
    draw(true);
  }

  const REMEMBER = 'mvm-uploader-last:';
  async function chooseDestination(o = {}) {
    const picker = window.mvmOS.filePicker;
    if (!picker) throw new Error('The file picker is not loaded');
    await picker.ready();
    let start = o.server?.start;
    try { if (o.rememberKey) start = localStorage.getItem(REMEMBER + o.rememberKey) || start; } catch (_) {}
    const result = await picker.open({
      mode: 'directory', sources: o.sources || ['server', 'shared'],
      server: {...(o.server || {}), start}, shared: {...(o.shared || {}), permission: 'upload'},
      labels: {title_directory: tr('choose_dest')},
    });
    if (!result) return null;
    const folder = result.folder || {};
    if (result.source === 'shared') return {type: 'shared', folderId: folder.shared.folderId, path: folder.shared.path || '', name: folder.shared.folderName};
    try { if (o.rememberKey) localStorage.setItem(REMEMBER + o.rememberKey, folder.path); } catch (_) {}
    return {type: 'server', path: folder.path};
  }

  // Ask what to upload (from this device), then where, then send it.
  async function choose(options = {}) {
    const picker = window.mvmOS.filePicker;
    if (!picker) throw new Error('The file picker is not loaded');
    await picker.ready();
    const what = options.files ? {files: options.files} : await picker.open({
      mode: options.mode || 'files', sources: ['device'], accept: options.accept || [], maxFiles: options.maxFiles || 1000,
      maxSize: options.maxSize || 0, hidden: !!options.hidden, labels: options.labels,
    });
    if (!what) return null;
    const destination = options.destination?.type ? options.destination : await chooseDestination(options.destination);
    if (!destination) return null;
    return upload({...options, files: what.files, destination});
  }

  // ---- panel ---------------------------------------------------------------
  function styles() {
    if (document.getElementById('mvm-up-style')) return;
    const s = document.createElement('style');
    s.id = 'mvm-up-style';
    const A = 'var(--pub-accent,var(--accent,#60a5fa))', B = 'var(--pub-border,var(--border,#45475a))',
      F = 'var(--pub-fg,var(--text,#e6e9f2))', D = 'var(--pub-fg2,var(--text-dim,#9aa4bd))',
      S1 = 'var(--pub-surface1,var(--surface,#1b2133))', S2 = 'var(--pub-surface2,var(--surface2,#252d45))';
    s.textContent = `
.mvm-up{position:fixed;right:16px;bottom:16px;z-index:2147483000;box-sizing:border-box;width:min(380px,calc(100vw - 24px));max-height:min(70dvh,520px);display:flex;flex-direction:column;border:1px solid ${B};border-radius:16px;background:${S1};color:${F};font:13px system-ui,sans-serif;box-shadow:0 16px 60px #0007;overflow:hidden}
.mvm-up *{box-sizing:border-box}.mvm-up button{font:inherit;color:inherit;cursor:pointer}
.mvm-up-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid ${B};font-weight:600}
.mvm-up-head span{flex:1}.mvm-up[data-min] .mvm-up-list{display:none}.mvm-up[data-min] .mvm-up-head{border-bottom:0}
.mvm-up-link{border:0;background:transparent;color:${D};font-size:12px;padding:4px 6px;border-radius:6px}.mvm-up-link:hover{background:${S2}}
.mvm-up-list{overflow:auto;display:flex;flex-direction:column}
.mvm-up-job{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-bottom:1px solid ${B}}.mvm-up-job:last-child{border-bottom:0}
.mvm-up-row{display:flex;align-items:center;gap:8px}.mvm-up-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-up-bar{height:6px;border-radius:3px;background:${S2};overflow:hidden}.mvm-up-bar i{display:block;height:100%;width:0;background:${A};border-radius:3px;transition:width .15s}
.mvm-up-job[data-state=done] .mvm-up-bar i{background:var(--pub-green,#22c55e)}.mvm-up-job[data-state=failed] .mvm-up-bar i{background:var(--pub-red,light-dark(#b42335,#fda4af))}
.mvm-up-job[data-state=waiting] .mvm-up-bar i,.mvm-up-job[data-state=cancelled] .mvm-up-bar i{opacity:.4}
.mvm-up-meta{display:flex;gap:8px;color:${D};font-size:12px;flex-wrap:wrap}.mvm-up-meta .mvm-up-dest{flex-basis:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mvm-up-err{color:var(--pub-red,light-dark(#b42335,#fda4af));font-size:12px;overflow-wrap:anywhere}
.mvm-up-act{border:1px solid ${B};background:transparent;border-radius:8px;padding:3px 9px;font-size:12px}.mvm-up-act:hover{background:${S2}}
@media (max-width:520px){.mvm-up{right:8px;bottom:8px;left:8px;width:auto}}`;
    document.head.appendChild(s);
  }
  function ensurePanel() {
    if (panel) return panel;
    styles();
    panel = document.createElement('div');
    panel.className = 'mvm-up';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-live', 'polite');
    panel.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const job = jobs.find(j => j.id === +b.dataset.id);
      const act = b.dataset.act;
      if (act === 'toggle') { collapsed = !collapsed; draw(true); }
      else if (act === 'clear') { for (let i = jobs.length - 1; i >= 0; i--) if (!['waiting', 'uploading'].includes(jobs[i].state)) jobs.splice(i, 1); draw(true); }
      else if (job) ({stop: cancel, retry, remove}[act] || (() => {}))(job);
    });
    document.body.appendChild(panel);
    return panel;
  }
  function stateText(j) {
    if (j.state === 'uploading') return j.finishing ? tr('finishing') : tr('uploading');
    if (j.state === 'done') return tr('done') + (j.extract ? ' · ' + tr('unpacked') : '');
    return tr(j.state === 'failed' ? 'failed' : j.state);
  }
  function draw(now) {
    if (!now) { if (drawTimer) return; drawTimer = setTimeout(() => { drawTimer = 0; paint(); }, 150); return; }
    clearTimeout(drawTimer); drawTimer = 0; paint();
  }
  function paint() {
    if (!jobs.length) { panel?.remove(); panel = null; return; }
    const p = ensurePanel();
    p.toggleAttribute('data-min', collapsed);
    const active = jobs.filter(j => ['waiting', 'uploading'].includes(j.state)).length;
    p.innerHTML = `<div class="mvm-up-head"><span>📤 ${esc(tr('title'))}${active ? ' (' + active + ')' : ''}</span>${jobs.some(j => !['waiting', 'uploading'].includes(j.state)) ? `<button type="button" class="mvm-up-link" data-act="clear">${esc(tr('clear'))}</button>` : ''}<button type="button" class="mvm-up-link" data-act="toggle" aria-label="${esc(tr(collapsed ? 'expand' : 'minimize'))}">${collapsed ? '▲' : '▼'}</button></div>
<div class="mvm-up-list">${jobs.map(j => {
      const sent = j.base + j.part, pct = j.state === 'done' ? 100 : j.total ? Math.min(100, Math.floor(sent / j.total * 100)) : 0;
      const live = j.state === 'uploading';
      const action = live || j.state === 'waiting' ? `<button type="button" class="mvm-up-act" data-act="stop" data-id="${j.id}">${esc(tr('stop'))}</button>`
        : `${['failed', 'cancelled'].includes(j.state) && (j.failed.length || j.pending.length) ? `<button type="button" class="mvm-up-act" data-act="retry" data-id="${j.id}">${esc(tr('retry'))}</button>` : ''}<button type="button" class="mvm-up-act" data-act="remove" data-id="${j.id}" aria-label="${esc(tr('remove'))}">✕</button>`;
      const multi = j.items.length > 1;
      return `<div class="mvm-up-job" data-state="${j.state}"><div class="mvm-up-row"><span class="mvm-up-name" title="${esc(live && multi ? j.currentName : j.label)}">${esc(live && multi ? j.currentName : j.label)}</span>${action}</div>
<div class="mvm-up-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
<div class="mvm-up-meta"><span>${esc(stateText(j))}</span><span>${pct}%</span><span>${esc(fmtSize(sent))} / ${esc(fmtSize(j.total))}</span>${live && j.speed > 0 ? `<span>${esc(fmtSize(j.speed))}/s</span>` : ''}${multi ? `<span>${esc(tr('n_done', {count: j.done, total: j.items.length}))}</span>` : ''}${j.failed.length ? `<span>${esc(tr('n_failed', {count: j.failed.length}))}</span>` : ''}<span class="mvm-up-dest" title="${esc(j.destLabel)}">${esc(tr('to', {dest: j.destLabel}))}</span></div>
${j.error && j.state !== 'uploading' ? `<div class="mvm-up-err" role="alert">${esc(j.error)}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  window.addEventListener('beforeunload', e => {
    if (jobs.some(j => ['waiting', 'uploading'].includes(j.state))) { e.preventDefault(); e.returnValue = tr('leave'); }
  });

  window.mvmOS.uploader = {upload, choose, chooseDestination, jobs: () => jobs.slice(), formatSize: fmtSize};
})();
