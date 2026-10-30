// Shared folders are remote references, not Linux mounts. All remote fetches,
// uploads and media sources go straight from this browser to the sharing host.
const SharedFiles = (() => {
  const prefix = '/pub/shared-files/v1/';
  const tr = key => t('sf_' + key);
  const join = (path, name) => path ? path.replace(/\/$/, '') + '/' + name : name;
  let sequence = 0;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  // In-page dialogs also work in Electron, which does not implement prompt().
  function dialog(message, options = {}) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = el('div', undefined, 'sf-dialog-overlay');
      const form = el('form', undefined, 'sf-dialog');
      form.setAttribute('role', 'dialog');
      form.setAttribute('aria-modal', 'true');
      const heading = el('h3', message);
      heading.id = 'sf-dialog-' + (++sequence);
      form.setAttribute('aria-labelledby', heading.id);
      form.append(heading);
      let input;
      if (options.value !== undefined) {
        input = field(form, message, options.value);
        input.required = true;
        input.maxLength = 255;
      }
      const actions = el('div', undefined, 'sf-actions');
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        overlay.remove();
        previousFocus?.focus();
        resolve(value);
      };
      if (!options.notice) {
        const cancel = el('button', tr('cancel'), 's-btn');
        cancel.type = 'button'; cancel.onclick = () => finish(null); actions.append(cancel);
      }
      const accept = el('button', tr(options.notice ? 'close' : 'confirm'), 's-btn');
      accept.type = 'submit'; actions.append(accept);
      form.append(actions); overlay.append(form); document.body.append(overlay);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (input && !input.value.trim()) { input.focus(); return; }
        finish(input ? input.value.trim() : true);
      });
      overlay.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); finish(null); }
        if (event.key === 'Tab') {
          const nodes = [...form.querySelectorAll('input,button')];
          const index = nodes.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1).focus(); }
          else if (!event.shiftKey && index === nodes.length - 1) { event.preventDefault(); nodes[0].focus(); }
        }
      });
      (input || accept).focus(); input?.select();
    });
  }
  function button(label, action, parent) {
    const node = el('button', label, 's-btn');
    node.type = 'button';
    node.addEventListener('click', async () => {
      node.disabled = true;
      try { await action(); } catch (error) { await dialog(tr('failed') + '\n' + error.message, {notice: true}); }
      finally { node.disabled = false; }
    });
    parent?.append(node);
    return node;
  }
  function field(parent, label, value = '', type = 'text') {
    const wrap = el('label', undefined, 'sf-field');
    wrap.append(el('span', label));
    const input = el('input');
    input.type = type;
    input.value = value;
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  async function json(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || response.statusText || tr('unavailable'));
    return data;
  }
  async function local(url, method = 'GET', data) {
    return json(await fetch(url, {method, headers: {'Content-Type': 'application/json', 'X-Mvm-Shared-Files': '1'},
      body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store'}));
  }
  function validateOrigin(value) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '') ||
      (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) {
      throw new Error(tr('invalid_address'));
    }
    return u.origin;
  }
  function base(folder) { return folder.origin + prefix + folder.grant_id; }
  async function remote(folder, suffix = '', method = 'GET', data, options = {}) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    try {
      return await json(await fetch(base(folder) + suffix, {method, mode: 'cors', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: abort.signal,
        headers: {'Authorization': 'Bearer ' + folder.secret, ...(data === undefined ? {} : {'Content-Type': 'application/json'}), ...options.headers},
        body: data === undefined ? undefined : JSON.stringify(data)}));
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') throw new Error(tr('connection_failed'));
      throw error;
    } finally { clearTimeout(timer); }
  }
  function windowBody(title, width, mount) {
    return Desktop.createWindow({id: 'shared-folders-' + (++sequence), pinKey: 'filemanager', title: '🌐 ' + el('span', title).innerHTML,
      width, height: 560, onMount(body) {
        body.classList.add('sf-root');
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => mount(body));
      }});
  }
  function changed() { window.dispatchEvent(new Event('shared-folders-changed')); }

  function share(path) {
    windowBody(tr('share'), 620, body => {
      body.append(el('p', tr('share_hint')), el('p', path, 'sf-path'));
      const form = el('form', undefined, 'sf-form');
      body.append(form);
      const name = field(form, tr('name'), path.split('/').filter(Boolean).pop() || '/');
      name.maxLength = 120;
      const recipient = field(form, tr('recipient'), '', 'url');
      recipient.placeholder = 'https://home.example.com';
      recipient.required = true;
      form.append(el('p', tr('rights_hint'), 'sf-muted'));
      const rights = {};
      for (const permission of ['read', 'upload', 'edit', 'delete']) {
        const label = el('label', undefined, 'sf-check');
        const input = el('input'); input.type = 'checkbox'; input.checked = permission === 'read';
        rights[permission] = input;
        label.append(input, document.createTextNode(tr(permission)));
        form.append(label);
      }
      const result = el('div', undefined, 'sf-result');
      const create = button(tr('create'), async () => {
        const origin = validateOrigin(recipient.value.trim());
        const data = await local('/api/files/sharing', 'POST', {path, name: name.value.trim(), recipient: origin,
          permissions: Object.keys(rights).filter(key => rights[key].checked)});
        const invitation = location.origin + '/#mvmos-folder=' + btoa(unescape(encodeURIComponent(JSON.stringify({v: 1, origin: location.origin,
          grant_id: data.id, secret: data.secret, name: data.name}))));
        create.remove();
        result.replaceChildren(el('p', tr('invitation_hint')));
        const output = el('textarea'); output.readOnly = true; output.value = invitation; output.rows = 4;
        output.addEventListener('focus', () => output.select());
        result.append(output);
        button(tr('copy'), async () => {
          try { await navigator.clipboard.writeText(invitation); }
          catch (_) { output.focus(); output.select(); document.execCommand('copy'); }
        }, result);
        changed();
      }, form);
      form.addEventListener('submit', e => { e.preventDefault(); create.click(); });
      form.append(result);
    });
  }

  function manage() {
    windowBody(tr('title'), 780, async body => {
      body.append(el('p', tr('overview')));
      const toolbar = el('div', undefined, 'sf-actions');
      const content = el('div');
      body.append(toolbar, content);
      const status = el('p', '', 'sf-muted');
      async function refresh() {
        content.replaceChildren(status); status.textContent = tr('checking');
        try {
          const data = await local('/api/files/sharing');
          content.replaceChildren();
          content.append(el('h3', tr('incoming')));
          if (!data.incoming.length) content.append(el('p', tr('empty'), 'sf-muted'));
          for (const folder of data.incoming) {
            const card = el('div', undefined, 'sf-card');
            card.append(el('strong', folder.name), el('div', folder.origin, 'sf-muted'));
            const state = el('span', tr('checking'), 'sf-status'); card.append(state);
            button(tr('open'), () => open(folder.id), card);
            button(tr('disconnect'), async () => {
              if (!await dialog(tr('disconnect_confirm'))) return;
              await local('/api/files/remote-folders/' + folder.id, 'DELETE'); changed(); await refresh();
            }, card);
            content.append(card);
            local('/api/files/remote-folders/' + folder.id).then(f => remote(f)).then(() => {
              state.textContent = tr('ready'); state.dataset.state = 'ready';
            }).catch(() => { state.textContent = tr('unavailable'); state.dataset.state = 'error'; });
          }
          content.append(el('h3', tr('outgoing')));
          if (!data.outgoing.length) content.append(el('p', tr('empty'), 'sf-muted'));
          for (const grant of data.outgoing) {
            const card = el('div', undefined, 'sf-card');
            card.append(el('strong', grant.name), el('div', grant.root, 'sf-path'),
              el('div', tr('recipient') + ': ' + grant.recipient, 'sf-muted'),
              el('div', [tr('browse'), ...grant.permissions.map(tr)].join(' · '), 'sf-muted'));
            button(tr('revoke'), async () => {
              if (!await dialog(tr('revoke_confirm'))) return;
              await local('/api/files/sharing/' + grant.id, 'DELETE'); changed(); await refresh();
            }, card);
            content.append(card);
          }
        } catch (error) { content.replaceChildren(el('p', tr('failed') + ' ' + error.message)); }
      }
      button(tr('connect'), () => connect(refresh), toolbar);
      button(tr('refresh'), refresh, toolbar);
      await refresh();
    });
  }

  function connect(onConnected) {
    windowBody(tr('connect'), 620, body => {
      body.append(el('p', tr('connect_hint')), el('p', tr('this_server') + ': ' + location.origin, 'sf-path'));
      const label = el('label', tr('invitation'), 'sf-field');
      const input = el('textarea'); input.rows = 5; label.append(input); body.append(label);
      button(tr('connect'), async () => {
        let folder;
        try {
          const url = new URL(input.value.trim());
          const encoded = url.hash.match(/^#mvmos-folder=([A-Za-z0-9+/=]+)$/)?.[1];
          folder = JSON.parse(decodeURIComponent(escape(atob(encoded || ''))));
          if (folder.v !== 1 || !/^[a-f0-9]{32}$/.test(folder.grant_id) || typeof folder.secret !== 'string' ||
            folder.secret.length < 32 || folder.secret.length > 128) throw new Error();
          folder.origin = validateOrigin(folder.origin);
          if (url.origin !== folder.origin) throw new Error();
        } catch (_) { throw new Error(tr('invalid_invitation')); }
        const info = await remote(folder);
        if (info.protocol !== 1 || info.recipient !== location.origin) throw new Error(tr('wrong_server'));
        const saved = await local('/api/files/remote-folders', 'POST', {origin: folder.origin, grant_id: folder.grant_id,
          secret: folder.secret, name: info.name});
        changed(); input.value = ''; body.replaceChildren(el('p', tr('connected')));
        button(tr('open'), () => open(saved.id), body);
        await onConnected?.();
      }, body);
    });
  }

  async function attachPlaces(parent, navigate) {
    const title = el('div', tr('title'), 'fm-places-user'); parent.append(title);
    const manageButton = el('div', '', 'fm-place');
    manageButton.append(el('span', '🌐', 'fm-place-icon'), el('span', tr('manage')));
    manageButton.title = tr('manage');
    manageButton.tabIndex = 0; manageButton.setAttribute('role', 'button');
    manageButton.addEventListener('click', manage);
    manageButton.addEventListener('keydown', e => { if (e.key === 'Enter') manage(); });
    parent.append(manageButton);
    try {
      const data = await local('/api/files/sharing');
      if (!parent.isConnected) return;
      for (const folder of data.incoming) {
        const item = el('div', '', 'fm-place'); item.title = folder.name + '\n' + folder.origin;
        item.append(el('span', '📂', 'fm-place-icon'), el('span', folder.name));
        item.dataset.path = virtualPath(folder.id);
        item.addEventListener('click', () => navigate ? navigate(virtualPath(folder.id)) : open(folder.id)); parent.append(item);
      }
    } catch (_) { /* Manager exposes connection errors on request. */ }
  }

  async function fileUrl(folder, path, download = false) {
    const result = await remote(folder, '/ticket', 'POST', {path});
    return base(folder) + '/file?ticket=' + encodeURIComponent(result.ticket) + (download ? '&download=1' : '');
  }
  async function preview(folder, entry, path) {
    const url = await fileUrl(folder, path);
    windowBody(entry.name, 800, body => {
      body.classList.add('sf-viewer');
      const ext = entry.name.split('.').pop().toLowerCase();
      let media;
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) { media = el('img'); media.alt = entry.name; }
      else if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) { media = el('video'); media.controls = true; media.preload = 'metadata'; }
      else if (['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav', 'm4b'].includes(ext)) { media = el('audio'); media.controls = true; media.preload = 'metadata'; }
      if (media) { media.referrerPolicy = 'no-referrer'; media.src = url; body.append(media); }
      else if (['txt', 'md', 'log', 'json', 'csv', 'xml', 'yaml', 'yml', 'js', 'py', 'css', 'html'].includes(ext) && entry.size <= 1024 * 1024) {
        const text = el('pre', tr('checking')); body.append(text);
        fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer'}).then(async r => {
          if (!r.ok) throw new Error(tr('unavailable')); text.textContent = await r.text();
        }).catch(error => { text.textContent = error.message; });
      } else { body.append(el('p', tr('no_preview'))); }
      button(tr('download'), () => downloadFile(folder, path), body);
      body.append(el('p', tr('direct_hint'), 'sf-muted'));
      // Release native media connections when the window closes.
      let renewal;
      if (media?.load) {
        renewal = setInterval(async () => {
          if (!body.isConnected) return;
          try {
            const next = await fileUrl(folder, path);
            const position = media.currentTime, playing = !media.paused;
            media.addEventListener('loadedmetadata', () => {
              media.currentTime = position;
              if (playing) media.play().catch(() => {});
            }, {once: true});
            media.src = next;
          } catch (_) { /* Retry when the source returns; existing streams may continue. */ }
        }, 50 * 60 * 1000);
      }
      const observer = new MutationObserver(() => {
        if (!body.isConnected) { clearInterval(renewal); if (media) { media.removeAttribute('src'); if (media.load) media.load(); } observer.disconnect(); }
      });
      observer.observe(document.body, {childList: true, subtree: true});
    });
  }
  async function downloadFile(folder, path) {
    const url = await fileUrl(folder, path, true);
    const link = el('a'); link.href = url; link.referrerPolicy = 'no-referrer';
    link.download = path.split('/').pop(); document.body.append(link); link.click(); link.remove();
  }

  // Virtual paths are File Manager locations, never host filesystem paths.
  function virtualPath(id, path = '') { return 'mvmos-share:/' + id + (path ? '/' + path : ''); }
  function parse(path) {
    const match = String(path).match(/^mvmos-share:\/([^/]+)(?:\/(.*))?$/);
    return match ? {id: match[1], path: match[2] || ''} : null;
  }
  async function locationFor(path) {
    const ref = parse(path);
    if (!ref) throw new Error(tr('unavailable'));
    return {...ref, folder: await local('/api/files/remote-folders/' + encodeURIComponent(ref.id))};
  }
  async function listing(path) {
    const loc = await locationFor(path);
    const data = await remote(loc.folder, '/list?path=' + encodeURIComponent(loc.path));
    // A remote listing is untrusted input, especially when copying to local disk.
    if (!Array.isArray(data.entries) || data.entries.some(entry =>
      typeof entry.name !== 'string' || !entry.name || entry.name.length > 255 || /[\/\0]/.test(entry.name) ||
      ['.', '..'].includes(entry.name) || !['dir', 'file'].includes(entry.type) ||
      !Number.isSafeInteger(entry.size) || entry.size < 0)) throw new Error(tr('invalid_listing'));
    if (!Array.isArray(data.permissions)) throw new Error(tr('invalid_listing'));
    data.entries = data.entries.map(entry => ({name: entry.name, type: entry.type, size: entry.size,
      modified: typeof entry.modified === 'string' && Number.isFinite(Date.parse(entry.modified)) ? new Date(entry.modified).toISOString() : ''}));
    return {...data, folder: loc.folder};
  }
  async function operation(path, op, extra = {}) {
    const loc = await locationFor(path);
    return remote(loc.folder, '/operations/' + op, 'POST', {path: loc.path, ...extra});
  }
  async function openFile(path, entry) {
    const loc = await locationFor(path);
    return preview(loc.folder, entry, loc.path);
  }
  async function downloadPath(path) {
    const loc = await locationFor(path);
    return downloadFile(loc.folder, loc.path);
  }
  function open(folderId) { FileManager.openWindow(virtualPath(folderId)); }

  async function checked(response) {
    if (!response.ok) await json(response);
    return response;
  }
  async function localRequest(path, suffix, method, data, key, signal) {
    const url = FileManager.adminUrl('/api/files' + suffix, key);
    return checked(await fetch(url, {method, signal, cache: 'no-store',
      headers: data === undefined ? {} : {'Content-Type': 'application/json'},
      body: data === undefined ? undefined : JSON.stringify(data)}));
  }
  async function entriesAt(path, key) {
    if (parse(path)) return (await listing(path)).entries;
    return (await (await localRequest(path, '?path=' + encodeURIComponent(path), 'GET', undefined, key)).json()).entries;
  }
  async function makeDir(path, key) {
    if (parse(path)) return operation(path, 'mkdir');
    return localRequest(path, '/mkdir', 'POST', {path}, key);
  }
  async function removePath(path, key) {
    if (parse(path)) return operation(path, 'delete');
    return localRequest(path, '/delete', 'DELETE', {path}, key);
  }
  // Stream files through bounded 4 MiB chunks instead of buffering whole files.
  async function writeFile(path, size, readChunk, key, signal, progress) {
    const loc = parse(path) ? await locationFor(path) : null;
    const chunkSize = 4 * 1024 * 1024;
    const transfer = loc ? await remote(loc.folder, '/uploads', 'POST', {path: loc.path, size}) : {id: crypto.randomUUID()};
    const name = path.split('/').pop(), parent = path.slice(0, path.lastIndexOf('/'));
    try {
      for (let offset = 0, index = 0; offset < size || index === 0; offset += chunkSize, index++) {
        signal.throwIfAborted();
        const bytes = await readChunk(Math.min(chunkSize, size - offset), offset + chunkSize >= size);
        if (loc) {
          await json(await fetch(base(loc.folder) + '/uploads/' + transfer.id, {method: 'PUT', mode: 'cors',
            credentials: 'omit', referrerPolicy: 'no-referrer', signal,
            headers: {'Authorization': 'Bearer ' + loc.folder.secret, 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset)}, body: bytes}));
        } else {
          const form = new FormData();
          Object.entries({upload_id: transfer.id, chunk_index: index, total_chunks: Math.max(1, Math.ceil(size / chunkSize)),
            filename: name, path: parent}).forEach(([k, v]) => form.append(k, String(v)));
          form.append('file', new Blob([bytes]), name);
          await checked(await fetch(FileManager.adminUrl('/api/files/upload-chunk', key), {method: 'POST', body: form, signal}));
        }
        progress(name, Math.min(size, offset + bytes.byteLength), size);
        if (!size) break;
      }
    } catch (error) {
      if (loc) await remote(loc.folder, '/uploads/' + transfer.id, 'DELETE').catch(() => {});
      else await fetch('/api/files/upload-chunk?upload_id=' + encodeURIComponent(transfer.id), {method: 'DELETE'}).catch(() => {});
      throw error;
    }
  }
  async function transferFile(src, dst, size, sourceKey, destKey, signal, progress) {
    let url;
    if (parse(src)) { const loc = await locationFor(src); url = await fileUrl(loc.folder, loc.path); }
    else url = FileManager.adminUrl('/api/files/raw?path=' + encodeURIComponent(src), sourceKey);
    const response = await checked(await fetch(url, {credentials: parse(src) ? 'omit' : 'same-origin', signal, referrerPolicy: 'no-referrer'}));
    const reader = response.body.getReader();
    let pending = new Uint8Array(), ended = false;
    try {
      await writeFile(dst, size, async (length, last) => {
        const chunk = new Uint8Array(length); let written = 0;
        while (written < length) {
          if (!pending.length) {
            const next = await reader.read(); ended = next.done;
            if (ended) throw new Error(tr('source_changed'));
            pending = next.value;
          }
          const count = Math.min(pending.length, length - written);
          chunk.set(pending.subarray(0, count), written); written += count; pending = pending.subarray(count);
        }
        if (last) {
          if (pending.length || (!ended && !(await reader.read()).done)) throw new Error(tr('source_changed'));
        }
        return chunk;
      }, destKey, signal, progress);
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function withTransfer(fm, work) {
    if (fm._transfer) return;
    const controller = new AbortController(); fm._transfer = controller;
    fm.mkdirBtn.disabled = fm.uploadBtn2.disabled = true;
    const cancel = button(tr('cancel_transfer'), () => controller.abort(), fm.body.querySelector('.fm-toolbar'));
    const observer = new MutationObserver(() => { if (!fm.body.isConnected) controller.abort(); });
    observer.observe(document.body, {childList: true, subtree: true});
    const progress = (name, done, total) => {
      fm.footerStatus.textContent = tr('transferring') + ' ' + name + ' · ' + Math.round(done / Math.max(1, total) * 100) + '%';
    };
    try { await work(controller.signal, progress); }
    catch (error) { await dialog(tr('failed') + '\n' + (error.name === 'AbortError' ? t('fm_upload_cancelled') : error.message), {notice: true}); }
    finally { observer.disconnect(); cancel.remove(); fm._transfer = null; await fm.navigate(fm.currentPath); }
  }
  async function copyPaths(fm, clipboard, destination = fm.currentPath) {
    return withTransfer(fm, async (signal, progress) => {
      const destKey = fm.adminKey, sourceKey = clipboard.adminKey;
      const existing = await entriesAt(destination, destKey);
      const plan = [], selected = [...new Set(clipboard.paths || [clipboard.path])];
      const roots = selected.filter(path => !selected.some(other => other !== path && path.startsWith(other.replace(/\/$/, '') + '/')));
      const scan = async (src, dst, entry, depth = 0) => {
        signal.throwIfAborted();
        if (depth > 64 || plan.length >= 10000) throw new Error(tr('transfer_limit'));
        const item = {src, dst, entry}; plan.push(item);
        if (entry.type === 'dir') {
          for (const child of await entriesAt(src, sourceKey)) await scan(join(src, child.name), join(dst, child.name), child, depth + 1);
        }
      };
      for (const src of roots) {
        const name = src.split('/').pop();
        if (existing.some(e => e.name === name)) throw new Error(tr('destination_exists') + ' ' + name);
        const source = parse(src), target = parse(destination);
        if (source) {
          const loc = await locationFor(src), info = await remote(loc.folder);
          if (!info.permissions.includes('read') || (clipboard.cut && !info.permissions.includes('delete'))) throw new Error(tr('permission_denied'));
          if (target) {
            const dstLoc = await locationFor(destination);
            if (loc.folder.origin === dstLoc.folder.origin && loc.folder.grant_id === dstLoc.folder.grant_id &&
              (dstLoc.path === loc.path || dstLoc.path.startsWith(loc.path + '/'))) throw new Error(tr('invalid_destination'));
          }
        } else if (!target && (destination === src || destination.startsWith(src + '/'))) throw new Error(tr('invalid_destination'));
        const parent = src.slice(0, src.lastIndexOf('/')) || '/';
        const entry = (await entriesAt(parent, sourceKey)).find(e => e.name === name);
        if (!entry) throw new Error(tr('unavailable'));
        await scan(src, join(destination, name), entry);
      }
      // Snapshot the whole source before writing, so a folder cannot copy into itself.
      if (parse(destination)) {
        const loc = await locationFor(destination), info = await remote(loc.folder);
        if (!info.permissions.includes('upload')) throw new Error(tr('permission_denied'));
      }
      for (const item of plan) {
        signal.throwIfAborted();
        progress(item.entry.name, 0, item.entry.size);
        if (item.entry.type === 'dir') await makeDir(item.dst, destKey);
        else await transferFile(item.src, item.dst, item.entry.size, sourceKey, destKey, signal, progress);
      }
      // A failed/cancelled copy always leaves the source intact.
      if (clipboard.cut) {
        for (const item of [...plan].reverse()) { signal.throwIfAborted(); await removePath(item.src, sourceKey); }
        if (window._fmClipboard === clipboard) window._fmClipboard = null;
      }
    });
  }
  async function uploadOne(fm, file, destDir, signal, progress) {
    let offset = 0;
    await writeFile(join(destDir, file.name), file.size, async length => {
      const chunk = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      offset += length; return chunk;
    }, fm.adminKey, signal, progress);
  }
  async function uploadList(fm, list) {
    return withTransfer(fm, async (signal, progress) => {
      for (const {file, destDir} of list) await uploadOne(fm, file, destDir, signal, progress);
    });
  }
  async function uploadEntries(fm, entries) {
    const destination = fm.currentPath;
    return withTransfer(fm, async (signal, progress) => {
      const visit = async (entry, parent, depth = 0) => {
        signal.throwIfAborted();
        if (depth > 64) throw new Error(tr('transfer_limit'));
        if (entry.isFile) {
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
          await uploadOne(fm, file, parent, signal, progress);
        } else if (entry.isDirectory) {
          const path = join(parent, entry.name);
          await makeDir(path, fm.adminKey);
          const reader = entry.createReader();
          while (true) {
            const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            if (!children.length) break;
            for (const child of children) await visit(child, path, depth + 1);
          }
        }
      };
      for (const entry of entries) await visit(entry, destination);
    });
  }
  async function removeSelection(fm, paths) {
    return withTransfer(fm, async signal => {
      for (const path of paths) { signal.throwIfAborted(); await deleteTree(path, signal); }
    });
  }
  async function deleteTree(path, signal) {
    const loc = await locationFor(path);
    const parent = loc.path.split('/').slice(0, -1).join('/');
    const entry = (await remote(loc.folder, '/list?path=' + encodeURIComponent(parent))).entries.find(e => e.name === loc.path.split('/').pop());
    if (!entry) throw new Error(tr('unavailable'));
    const plan = [];
    const scan = async (target, item, depth = 0) => {
      signal?.throwIfAborted();
      if (depth > 64 || plan.length >= 10000) throw new Error(tr('transfer_limit'));
      plan.push(target);
      if (item.type === 'dir') for (const child of (await listing(target)).entries) await scan(join(target, child.name), child, depth + 1);
    };
    await scan(path, entry);
    for (const target of plan.reverse()) { signal?.throwIfAborted(); await operation(target, 'delete'); }
  }
  return {share, manage, attachPlaces, open, virtualPath, parse, listing, operation, openFile, downloadPath,
    dialog, copyPaths, uploadList, uploadEntries, removeSelection};
})();
