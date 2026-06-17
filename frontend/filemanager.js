// ── File Manager window ──────────────────────────────────────────────────────

const FileManager = (() => {
  let fmCount = 0;

  function loadPrefs() { return Settings.loadFMPrefs(); }

  function openWindow(startPath) {
    fmCount++;
    const id = 'filemanager-' + fmCount;

    Desktop.createWindow({
      id,
      title: `📁 ${t('app_filemanager')}`,
      width: 720,
      height: 480,
      appSettings: 'filemanager',
      onMount(body) {
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => {
          const fm = new FMInstance(body);
          if (startPath) {
            fm.navigate(startPath);
          } else {
            fetch('/api/files/places').then(r => r.json()).then(d => fm.navigate(d.home)).catch(() => fm.navigate('/'));
          }
          fm.autoCleanTrash();
          fm.autoCleanChunks();
          Desktop.initMobileSidebar(body);
        });
      },
    });
  }

  class FMInstance {
    constructor(body) {
      this.body = body;
      this.currentPath = '/';
      this.selected = null;
      this.selectedSet = new Set(); // multi-select
      this._lastClickedName = null;
      window.addEventListener('fm-prefs-changed', () => this.navigate(this.currentPath));

      body.innerHTML = `
        <div class="fm-container">
          <div class="fm-toolbar">
            <button class="fm-up">${t('fm_up')}</button>
            <span class="fm-breadcrumb"></span>
            <input class="fm-search" type="text" placeholder="${t('fm_search_ph')}" autocomplete="off">
            <button class="fm-search-deep" title="${t('fm_search_deep_title')}">🔍</button>
            <button class="fm-mkdir">${t('fm_new_folder')}</button>
            <button class="fm-upload-btn">${t('fm_upload')}</button>
            <input type="file" class="fm-upload-input" style="display:none" multiple>
            <button class="fm-trash-restore-all" style="display:none">${t('fm_trash_restore_all')}</button>
            <button class="fm-trash-empty" style="display:none">${t('fm_trash_empty_btn')}</button>
          </div>
          <div class="fm-body">
            <nav class="fm-places"></nav>
            <div class="fm-list"></div>
            <div class="fm-preview" style="display:none">
              <button class="fm-preview-close">✕</button>
              <img class="fm-preview-img" src="" alt="">
              <div class="fm-preview-name"></div>
              <div class="fm-preview-meta"></div>
            </div>
          </div>
          <div class="fm-footer">
            <span class="fm-footer-status"></span>
          </div>
        </div>
      `;

      this.listEl     = body.querySelector('.fm-list');
      this.breadEl    = body.querySelector('.fm-breadcrumb');
      this.placesEl   = body.querySelector('.fm-places');
      this.searchEl   = body.querySelector('.fm-search');

      this.searchEl.addEventListener('input', () => {
        const q = this.searchEl.value.trim().toLowerCase();
        if (!this._lastEntries) return;
        const filtered = q ? this._lastEntries.filter(e => e.name.toLowerCase().includes(q)) : this._lastEntries;
        this.render(filtered, true);
      });
      this.searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this.searchEl.value = ''; this.render(this._lastEntries || []); }
        if (e.key === 'Enter') deepSearch();
      });

      const deepSearch = async () => {
        const q = this.searchEl.value.trim();
        if (!q) return;
        this.footerStatus.textContent = t('fm_searching');
        const res = await fetch(`/api/files/search?path=${encodeURIComponent(this.currentPath)}&q=${encodeURIComponent(q)}`);
        if (!res.ok) { this.footerStatus.textContent = t('fm_search_failed'); return; }
        const data = await res.json();
        this.footerStatus.textContent = t('fm_results', {n: data.results.length, s: data.results.length !== 1 ? 's' : '', q});
        this.listEl.innerHTML = '';
        if (!data.results.length) {
          this.listEl.innerHTML = `<div class="fm-empty">${t('fm_no_results')}</div>`;
          return;
        }
        data.results.forEach(entry => {
          const row = document.createElement('div');
          row.className = 'fm-entry';
          row.dataset.name = entry.name;
          row.dataset.type = entry.type;
          const icon = entry.type === 'dir' ? '📁' : this.fileIcon(entry.name);
          const relPath = entry.path.replace(this.currentPath, '').replace(/^\//, '');
          row.innerHTML = `
            <span class="fm-icon">${icon}</span>
            <span class="fm-name">${entry.name}</span>
            <span class="fm-size" style="flex:1;color:var(--text-dim);font-size:.75rem;">${relPath}</span>
          `;
          row.addEventListener('dblclick', () => {
            if (entry.type === 'dir') { this.navigate(entry.path); }
            else { this.navigate(entry.path.substring(0, entry.path.lastIndexOf('/'))); }
          });
          this.listEl.appendChild(row);
        });
      };
      body.querySelector('.fm-search-deep').addEventListener('click', deepSearch);
      this.previewEl  = body.querySelector('.fm-preview');
      this.previewImg = body.querySelector('.fm-preview-img');
      this.previewName = body.querySelector('.fm-preview-name');
      this.previewMeta = body.querySelector('.fm-preview-meta');
      this._previewClosed = false;
      body.querySelector('.fm-preview-close').addEventListener('click', () => {
        this._previewClosed = true;
        this.previewEl.style.display = 'none';
      });
      this.footerStatus  = body.querySelector('.fm-footer-status');

      this.mkdirBtn       = body.querySelector('.fm-mkdir');
      this.uploadBtn2     = body.querySelector('.fm-upload-btn');
      this.trashRestoreAllBtn = body.querySelector('.fm-trash-restore-all');
      this.trashEmptyBtn  = body.querySelector('.fm-trash-empty');

      body.querySelector('.fm-up').addEventListener('click', () => this.goUp());
      this.mkdirBtn.addEventListener('click', () => this.mkdirPrompt());
      this.trashRestoreAllBtn.addEventListener('click', () => this.trashRestoreAll());
      this.trashEmptyBtn.addEventListener('click', () => this.trashEmpty());

      this.loadPlaces();

      const uploadBtn   = body.querySelector('.fm-upload-btn');
      const uploadInput = body.querySelector('.fm-upload-input');
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => this.uploadFiles(uploadInput.files));

      // drag-and-drop upload from OS
      // block dragover/drop on the whole body to prevent browser from navigating to dropped HTML files
      const bodyDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; };
      const bodyDrop = e => { e.preventDefault(); };
      body.addEventListener('dragover', bodyDragOver);
      body.addEventListener('drop', bodyDrop);

      this.listEl.addEventListener('dragover', e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          this.listEl.classList.add('fm-drop-hover');
        }
      });
      this.listEl.addEventListener('dragleave', e => {
        if (!this.listEl.contains(e.relatedTarget)) this.listEl.classList.remove('fm-drop-hover');
      });
      this.listEl.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        this.listEl.classList.remove('fm-drop-hover');
        const items = [...e.dataTransfer.items].filter(i => i.kind === 'file');
        if (items.length) {
          this.uploadEntries(items.map(i => i.webkitGetAsEntry()).filter(Boolean));
        }
      });

      // right-click context menu on list
      this.listEl.addEventListener('contextmenu', e => this.onContextMenu(e));

      // keyboard copy/cut/paste
      body.addEventListener('keydown', e => {
        const names = this.selectedSet.size > 0 ? [...this.selectedSet] : (this.selected ? [this.selected.name] : []);
        if (e.key === 'c' && (e.ctrlKey || e.metaKey) && names.length) {
          window._fmClipboard = { paths: names.map(n => this.joinPath(this.currentPath, n)), cut: false };
        }
        if (e.key === 'x' && (e.ctrlKey || e.metaKey) && names.length) {
          window._fmClipboard = { paths: names.map(n => this.joinPath(this.currentPath, n)), cut: true };
        }
        if (e.key === 'v' && (e.ctrlKey || e.metaKey) && window._fmClipboard) {
          this.paste();
        }
        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this._lastEntries?.forEach(en => this.selectedSet.add(en.name));
          this.listEl.querySelectorAll('.fm-entry').forEach(r => r.classList.add('selected'));
        }
      }, true);
    }

    async loadPlaces() {
      try {
        const res = await fetch('/api/files/places');
        const data = await res.json();
        this.placesEl.innerHTML = '';

        // username label
        const userLabel = document.createElement('div');
        userLabel.className = 'fm-places-user';
        userLabel.textContent = data.username;
        this.placesEl.appendChild(userLabel);

        // Home (always)
        this._addPlace('🏠', t('fm_home'), data.home);

        // XDG folders (only if exist)
        if (data.xdg.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'fm-places-sep';
          this.placesEl.appendChild(sep);
          data.xdg.forEach(p => this._addPlace(p.icon, p.name, p.path));
        }

        // separator + Computer + Trash
        const sep2 = document.createElement('div');
        sep2.className = 'fm-places-sep';
        this.placesEl.appendChild(sep2);
        this._addPlace('💻', t('fm_computer'), '/');
        this._addPlace('🗑️', t('fm_trash'), '__trash__');

        // Bookmarks
        const bookmarks = this._loadBookmarks();
        if (bookmarks.length > 0) {
          const sep3 = document.createElement('div');
          sep3.className = 'fm-places-sep';
          this.placesEl.appendChild(sep3);
          const bLabel = document.createElement('div');
          bLabel.className = 'fm-places-user';
          bLabel.textContent = t('fm_bookmarks');
          this.placesEl.appendChild(bLabel);
          bookmarks.forEach(b => this._addBookmark(b.name, b.path));
        }

        // Add bookmark button
        const addBtn = document.createElement('div');
        addBtn.className = 'fm-place fm-bookmark-add';
        addBtn.innerHTML = `<span class="fm-place-icon">＋</span><span>Add Bookmark</span>`;
        addBtn.addEventListener('click', () => this._addCurrentAsBookmark());
        this.placesEl.appendChild(addBtn);

        this.updateActivePlacea(this.currentPath);
      } catch (_) {}
    }

    _loadBookmarks() {
      try { return JSON.parse(localStorage.getItem('fm-bookmarks') || '[]'); } catch { return []; }
    }

    _saveBookmarks(bookmarks) {
      localStorage.setItem('fm-bookmarks', JSON.stringify(bookmarks));
    }

    _addCurrentAsBookmark() {
      const path = this.currentPath;
      const name = path.split('/').pop() || '/';
      const bookmarks = this._loadBookmarks();
      if (bookmarks.find(b => b.path === path)) return;
      bookmarks.push({ name, path });
      this._saveBookmarks(bookmarks);
      this.loadPlaces();
    }

    _removeBookmark(path) {
      const bookmarks = this._loadBookmarks().filter(b => b.path !== path);
      this._saveBookmarks(bookmarks);
      this.loadPlaces();
    }

    _addBookmark(name, path) {
      const el = document.createElement('div');
      el.className = 'fm-place';
      el.dataset.path = path;
      el.innerHTML = `<span class="fm-place-icon">🔖</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${name}</span><span class="fm-bookmark-remove" title="Remove">✕</span>`;
      el.querySelector('.fm-bookmark-remove').addEventListener('click', e => {
        e.stopPropagation();
        this._removeBookmark(path);
      });
      el.addEventListener('click', e => {
        if (e.target.classList.contains('fm-bookmark-remove')) return;
        this.navigate(path);
      });
      this.placesEl.appendChild(el);
    }

    _addPlace(icon, name, path) {
      const el = document.createElement('div');
      el.className = 'fm-place';
      el.dataset.path = path;
      el.innerHTML = `<span class="fm-place-icon">${icon}</span><span>${name}</span>`;
      el.addEventListener('click', () => this.navigate(path));
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        const menu = document.createElement('div');
        menu.className = 'fm-ctx';
        menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:99999;min-width:150px;overflow:hidden;`;
        const addItem = (text, onClick) => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:.85rem;';
          item.textContent = text;
          item.addEventListener('mouseenter', () => item.style.background = 'var(--surface2)');
          item.addEventListener('mouseleave', () => item.style.background = '');
          item.addEventListener('click', () => { menu.remove(); onClick(); });
          menu.appendChild(item);
        };
        if (window._fmClipboard) {
          addItem('📋 Paste', async () => {
            const cb = window._fmClipboard;
            const paths = cb.paths || [cb.path];
            for (const src of paths) {
              await fetch('/api/files/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ src, dst_dir: path, move: cb.cut }),
              });
            }
            if (cb.cut) window._fmClipboard = null;
            this.navigate(this.currentPath);
          });
        }
        addItem('⬛ Open in Terminal', () => {
          Terminal.openWindow();
          setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: `cd ${path}` })), 500);
        });
        document.body.appendChild(menu);
        const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
        setTimeout(() => document.addEventListener('click', dismiss), 0);
      });
      this.placesEl.appendChild(el);
    }

    updateActivePlacea(path) {
      this.placesEl.querySelectorAll('.fm-place').forEach(el => {
        el.classList.toggle('active', el.dataset.path === path);
      });
    }

    _setTrashMode(on) {
      this._inTrash = on;
      this.mkdirBtn.style.display      = on ? 'none' : '';
      this.uploadBtn2.style.display    = on ? 'none' : '';
      this.trashRestoreAllBtn.style.display = on ? '' : 'none';
      this.trashEmptyBtn.style.display = on ? '' : 'none';
    }

    async navigate(path) {
      if (this._navigating) return;
      this._navigating = true;
      this.currentPath = path;
      this.selected = null;
      this.selectedSet.clear();
      this._lastClickedName = null;
      this.footerStatus.textContent = '';
      this.searchEl.value = '';
      this.updatePreview(null);
      this.updateActivePlacea(path);

      // ── Trash view ──
      if (path === '__trash__') {
        this._setTrashMode(true);
        this.breadEl.innerHTML = `<span class="fm-bread-btn">🗑️ ${t('fm_trash')}</span>`;
        try {
          const res = await fetch('/api/files/trash/list');
          const items = await res.json();
          this.renderTrash(items);
        } catch { this.showError(t('fm_network_error')); }
        finally { this._navigating = false; }
        return;
      }

      this._setTrashMode(false);
      // breadcrumb buttons
      this.breadEl.innerHTML = '';
      const parts = path.split('/').filter(p => p);
      let built = '';
      parts.forEach((part, i) => {
        built += '/' + part;
        const seg = built;
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'fm-bread-sep';
          sep.textContent = '/';
          this.breadEl.appendChild(sep);
        }
        const btn = document.createElement('span');
        btn.className = 'fm-bread-btn';
        btn.textContent = part;
        btn.addEventListener('click', () => this.navigate(seg));
        this.breadEl.appendChild(btn);
      });

      try {
        const url = `/api/files?path=${encodeURIComponent(path)}` + (this._asRoot ? '&as_root=true' : '');
        const res = await fetch(url);
        if (!res.ok) { this.showError(t('fm_cannot_read')); return; }
        const data = await res.json();
        this._updateRootBadge(!!data.as_root);
        this.render(data.entries);
      } catch (e) {
        this.showError(t('fm_network_error'));
      } finally {
        this._navigating = false;
      }
    }

    async navigateAsRoot(path) {
      this._asRoot = true;
      await this.navigate(path);
      // keep _asRoot=true so sub-navigation stays as root
    }

    navigateNormal(path) {
      this._asRoot = false;
      this._updateRootBadge(false);
      return this.navigate(path);
    }

    _updateRootBadge(isRoot) {
      const win = this.body.closest('.window');
      if (!win) return;
      const titleEl = win.querySelector('.window-title');
      if (!titleEl) return;
      const base = `📁 ${t('app_filemanager')}`;
      titleEl.textContent = isRoot ? `${base} (root)` : base;
      let badge = win.querySelector('.fm-root-badge');
      if (isRoot && !badge) {
        badge = document.createElement('span');
        badge.className = 'fm-root-badge';
        badge.title = t('fm_exit_root');
        badge.innerHTML = '🔓 root ✕';
        badge.addEventListener('click', () => {
          this._asRoot = false;
          this._updateRootBadge(false);
          this.navigate(this.currentPath);
        });
        titleEl.after(badge);
      } else if (!isRoot && badge) {
        badge.remove();
      }
    }

    renderTrash(items) {
      this.listEl.innerHTML = '';
      if (items.length === 0) {
        this.listEl.innerHTML = `<div class="fm-empty">${t('fm_trash_empty_folder')}</div>`;
        return;
      }
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'fm-entry';
        row.dataset.name = item.name;
        row.dataset.type = item.type;
        const icon = item.type === 'dir' ? '📁' : this.fileIcon(item.original_name);
        const date = item.date ? item.date.slice(0, 16).replace('T', ' ') : '';
        row.innerHTML = `
          <span class="fm-entry-icon">${icon}</span>
          <span class="fm-entry-name">${item.original_name}</span>
          <span class="fm-entry-size" style="color:var(--text-dim);font-size:.8rem">${item.original_path}</span>
          <span class="fm-entry-date">${date}</span>`;
        row.addEventListener('contextmenu', e => {
          e.preventDefault(); e.stopPropagation();
          this._showTrashCtxMenu(e, item);
        });
        this.listEl.appendChild(row);
      });
    }

    _showTrashCtxMenu(e, item) {
      const existing = document.getElementById('fm-ctx');
      if (existing) existing.remove();
      const menu = document.createElement('div');
      menu.id = 'fm-ctx';
      menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,.4)`;
      const addItem = (label, action, danger) => {
        const el = document.createElement('div');
        el.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:.85rem;transition:background .1s;';
        if (danger) el.style.color = '#e05555';
        el.textContent = label;
        el.addEventListener('mouseenter', () => el.style.background = 'var(--surface2)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => { action(); menu.remove(); });
        menu.appendChild(el);
      };
      addItem(t('fm_trash_restore'), () => this.trashRestore([item.name]));
      addItem(t('fm_trash_delete_perm'), () => this.trashDeletePermanent([item.name]), true);
      document.body.appendChild(menu);
      const close = () => { menu.remove(); document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close), 0);
    }

    async trashRestore(names) {
      await fetch('/api/files/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      this.navigate('__trash__');
    }

    async trashRestoreAll() {
      const res = await fetch('/api/files/trash/list');
      const items = await res.json();
      if (items.length === 0) return;
      await this.trashRestore(items.map(i => i.name));
    }

    async trashEmpty() {
      if (!confirm(t('fm_trash_confirm_empty'))) return;
      await fetch('/api/files/trash/empty', { method: 'DELETE' });
      this.navigate('__trash__');
    }

    async trashDeletePermanent(names) {
      if (!confirm(t('fm_trash_confirm_perm').replace('{n}', names.length))) return;
      // use trash files path for permanent deletion
      for (const name of names) {
        await fetch('/api/files/trash/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: [] }), // noop
        });
      }
      // actually delete via /api/files/delete using trash path
      const res2 = await fetch('/api/files/trash/list');
      const all = await res2.json();
      // get home to build trash path
      const placesRes = await fetch('/api/files/places');
      const places = await placesRes.json();
      const trashFilesPath = `${places.home}/.Trash/files`;
      for (const name of names) {
        await fetch('/api/files/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `${trashFilesPath}/${name}` }),
        });
        // also remove trashinfo
        await fetch('/api/files/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `${places.home}/.Trash/info/${name}.trashinfo` }),
        });
      }
      this.navigate('__trash__');
    }

    render(entries, fromSearch = false) {
      if (!fromSearch) this._lastEntries = entries;
      if (!loadPrefs().showHidden) entries = entries.filter(e => !e.name.startsWith('.'));
      entries = [...entries].sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
      if (entries.length === 0) {
        this.listEl.innerHTML = '<div class="fm-empty">Empty folder</div>';
        return;
      }

      const prefs = loadPrefs();
      this.listEl.innerHTML = '';
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'fm-entry';
        row.dataset.name = entry.name;
        row.dataset.type = entry.type;

        const icon = entry.type === 'dir' ? '📁' : this.fileIcon(entry.name);
        const size = entry.type === 'dir' ? '—' : this.formatSize(entry.size);
        const date = entry.modified ? entry.modified.slice(0, 16).replace('T', ' ') : '';

        const isRoot = window._effectiveUser === 'root';
        const permsHtml = prefs.showPerms
          ? `<span class="fm-perms${isRoot ? ' fm-editable' : ''}" title="${isRoot ? t('fm_perms_title') : ''}">${entry.permissions || ''}</span>` : '';
        const ownerHtml = prefs.showOwner
          ? `<span class="fm-owner${isRoot ? ' fm-editable' : ''}" title="${isRoot ? 'Click to change' : ''}">${entry.owner || ''}${entry.group ? ':'+entry.group : ''}</span>` : '';

        row.innerHTML = `
          <span class="fm-icon">${icon}</span>
          <span class="fm-name">${entry.name}</span>
          <span class="fm-size">${size}</span>
          ${permsHtml}
          ${ownerHtml}
          <span class="fm-date">${date}</span>
        `;

        row.addEventListener('click', e => {
          if (e.target.classList.contains('fm-editable')) return;
          if (e.ctrlKey || e.metaKey) {
            if (this.selectedSet.has(entry.name)) {
              this.selectedSet.delete(entry.name);
              row.classList.remove('selected');
            } else {
              this.selectedSet.add(entry.name);
              row.classList.add('selected');
            }
            this.selected = entry;
            this._lastClickedName = entry.name;
          } else if (e.shiftKey && this._lastClickedName) {
            const rows = [...this.listEl.querySelectorAll('.fm-entry')];
            const names = rows.map(r => r.dataset.name);
            const a = names.indexOf(this._lastClickedName);
            const b = names.indexOf(entry.name);
            const [lo, hi] = a < b ? [a, b] : [b, a];
            this.selectedSet.clear();
            rows.forEach((r, i) => {
              if (i >= lo && i <= hi) { this.selectedSet.add(r.dataset.name); r.classList.add('selected'); }
              else r.classList.remove('selected');
            });
            this.selected = entry;
          } else {
            this.selectedSet.clear();
            this.listEl.querySelectorAll('.fm-entry').forEach(r => r.classList.remove('selected'));
            this.selectedSet.add(entry.name);
            row.classList.add('selected');
            this.selected = entry;
            this._lastClickedName = entry.name;
          }
          this.updateFooterSelection();
          this.updatePreview(this.selectedSet.size === 1 ? entry : null);
        });

        if (entry.type === 'dir') {
          row.addEventListener('dblclick', e => {
            if (e.target.classList.contains('fm-editable')) return;
            this.navigate(this.joinPath(this.currentPath, entry.name));
          });
        } else {
          row.addEventListener('dblclick', e => {
            if (e.target.classList.contains('fm-editable')) return;
            const fullPath = this.joinPath(this.currentPath, entry.name);
            if (entry.name.endsWith('.url')) {
              fetch(`/api/files/raw?path=${encodeURIComponent(fullPath)}`)
                .then(r => r.text())
                .then(text => {
                  const match = text.match(/^URL=(.+)$/m);
                  if (match) window.open(match[1].trim(), '_blank');
                });
            } else if (ImageViewer.isImage(entry.name)) {
              ImageViewer.openWindow(fullPath, this._lastEntries);
            } else if (VideoPlayer.isVideo(entry.name) || VideoPlayer.isAudio(entry.name)) {
              VideoPlayer.openWindow(fullPath);
            } else if (/\.(zip|tar|tar\.gz|tgz|tar\.bz2|tar\.xz)$/i.test(entry.name)) {
              fetch('/api/files/extract', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: fullPath }) })
                .then(r => r.json()).then(res => { if (res.ok) this.navigate(this.currentPath); });
            } else if (CodeEditor.isCode(entry.name)) {
              CodeEditor.openFile(fullPath);
            } else if (TextEditor.isText(entry.name)) {
              TextEditor.openWindow(fullPath);
            }
          });
        }

        if (prefs.showPerms && isRoot) {
          row.querySelector('.fm-perms').addEventListener('click', e => {
            e.stopPropagation();
            this.inlineEdit(e.target, entry.permissions, async val => {
              if (!/^[0-7]{3,4}$/.test(val)) return;
              await fetch('/api/files/chmod', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.joinPath(this.currentPath, entry.name), mode: val }),
              });
              this.navigate(this.currentPath);
            });
          });
        }

        if (prefs.showOwner && isRoot) {
          row.querySelector('.fm-owner').addEventListener('click', e => {
            e.stopPropagation();
            const current = entry.owner + (entry.group ? ':' + entry.group : '');
            this.inlineEdit(e.target, current, async val => {
              const [owner, group = ''] = val.split(':');
              await fetch('/api/files/chown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.joinPath(this.currentPath, entry.name), owner, group }),
              });
              this.navigate(this.currentPath);
            });
          });
        }

        this.listEl.appendChild(row);
      });
    }

    inlineEdit(el, currentVal, onCommit) {
      if (el.querySelector('input')) return;
      const orig = el.textContent;
      el.textContent = '';
      const input = document.createElement('input');
      input.className = 'fm-inline-input';
      input.value = currentVal;
      el.appendChild(input);
      input.focus();
      input.select();

      const commit = async () => {
        const val = input.value.trim();
        input.remove();
        el.textContent = orig;
        if (val && val !== currentVal) await onCommit(val);
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.remove(); el.textContent = orig; }
      });
    }

    onContextMenu(e) {
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest('.fm-entry');

      const menu = document.createElement('div');
      menu.className = 'fm-ctx';
      menu.style.cssText = `
        position:fixed;left:${e.clientX}px;top:${e.clientY}px;
        background:var(--surface);border:1px solid var(--border);
        border-radius:var(--radius);box-shadow:var(--shadow);
        z-index:99999;min-width:150px;overflow:hidden;
      `;

      const items = [];
      if (row) {
        const name = row.dataset.name;
        const names = this.selectedSet.size > 1 ? [...this.selectedSet] : [name];
        if (names.length === 1) items.push({ label: '✏️ Rename', action: () => this.renamePrompt(name) });
        items.push({ label: `📋 Copy${names.length > 1 ? ' ('+names.length+')' : ''}`, action: () => { window._fmClipboard = { paths: names.map(n => this.joinPath(this.currentPath, n)), cut: false }; } });
        items.push({ label: `✂️ Cut${names.length > 1 ? ' ('+names.length+')' : ''}`,  action: () => { window._fmClipboard = { paths: names.map(n => this.joinPath(this.currentPath, n)), cut: true  }; } });
        items.push({ label: `🗑️ Delete${names.length > 1 ? ' ('+names.length+')' : ''}`, action: () => this.deleteEntries(names), danger: true });
        items.push({ label: `⬇️ Download${names.length > 1 ? ' ('+names.length+')' : ''}`, action: () => this.download(names) });
        items.push({ label: `🗜️ Compress to zip`, action: () => this.compressToZip(names) });
        if (names.length === 1) items.push({ label: 'ℹ️ Info', action: () => this.showInfo(this._lastEntries.find(e => e.name === name)) });
      } else {
        if (window._fmClipboard) {
          items.push({ label: '📋 Paste', action: () => this.paste() });
        }
        items.push({ label: '⬛ Open in Terminal', action: () => {
          Terminal.openWindow();
          setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: `cd ${this.currentPath}` })), 500);
        }});
        items.push({ label: '📁 New Folder', action: () => this.mkdirPrompt() });
        items.push({ label: '🔄 Refresh', action: () => this.navigate(this.currentPath) });
      }

      items.forEach(item => {
        const el = document.createElement('div');
        el.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:.85rem;transition:background .1s;';
        if (item.danger) el.style.color = '#e05555';
        el.textContent = item.label;
        el.addEventListener('mouseenter', () => el.style.background = 'var(--surface2)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => { item.action(); menu.remove(); });
        menu.appendChild(el);
      });

      document.body.appendChild(menu);
      const dismiss = e => { menu.remove(); document.removeEventListener('click', dismiss); };
      setTimeout(() => document.addEventListener('click', dismiss), 0);
    }

    async paste() {
      const cb = window._fmClipboard;
      if (!cb) return;
      const paths = cb.paths || [cb.path];
      for (const src of paths) {
        await fetch('/api/files/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ src, dst_dir: this.currentPath, move: cb.cut }),
        });
      }
      if (cb.cut) window._fmClipboard = null;
      this.navigate(this.currentPath);
    }

    async autoCleanChunks() {
      fetch('/api/files/upload-chunk/cleanup', { method: 'POST' }).catch(() => {});
    }

    async autoCleanTrash() {
      const prefs = loadPrefs();
      const days = prefs.trashDays !== undefined ? prefs.trashDays : 30;
      if (!days) return;
      try {
        const res = await fetch('/api/files/trash/list');
        const items = await res.json();
        const cutoff = Date.now() - days * 86400000;
        const old = items.filter(i => i.date && new Date(i.date).getTime() < cutoff).map(i => i.name);
        if (!old.length) return;
        // permanently delete old items
        const placesRes = await fetch('/api/files/places');
        const places = await placesRes.json();
        const trashFiles = `${places.home}/.Trash/files`;
        const trashInfo  = `${places.home}/.Trash/info`;
        for (const name of old) {
          await fetch('/api/files/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `${trashFiles}/${name}` }) });
          await fetch('/api/files/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: `${trashInfo}/${name}.trashinfo` }) });
        }
      } catch (_) {}
    }

    async deleteEntries(names) {
      const prefs = loadPrefs();
      const trashAsk = prefs.trashAsk !== false;
      let choice;
      if (trashAsk) {
        choice = await this._deleteDialog(names.length);
        if (!choice) return;
      } else {
        choice = 'permanent';
      }
      if (choice === 'trash') {
        const paths = names.map(n => this.joinPath(this.currentPath, n));
        const r = await fetch('/api/files/trash/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          this.showError(err.detail || 'Could not move to trash');
          return;
        }
      } else {
        for (const name of names) {
          await fetch('/api/files/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: this.joinPath(this.currentPath, name) }),
          });
        }
      }
      this.navigate(this.currentPath);
    }

    _deleteDialog(count) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:280px;max-width:360px;box-shadow:var(--shadow)">
            <div style="font-size:1rem;margin-bottom:16px;">${t('fm_delete_title').replace('{n}', count)}</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <button id="del-trash" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:var(--text);cursor:pointer;text-align:left;">${t('fm_delete_to_trash')}</button>
              <button id="del-perm" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:#e05555;cursor:pointer;text-align:left;">${t('fm_delete_permanent')}</button>
              <button id="del-cancel" style="background:transparent;border:none;padding:6px;color:var(--text-dim);cursor:pointer;">${t('fm_delete_cancel')}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#del-trash').addEventListener('click',  () => { overlay.remove(); resolve('trash'); });
        overlay.querySelector('#del-perm').addEventListener('click',   () => { overlay.remove(); resolve('permanent'); });
        overlay.querySelector('#del-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
      });
    }

    async renamePrompt(name) {
      const newName = prompt(`Rename "${name}" to:`, name);
      if (!newName || newName === name) return;
      await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.joinPath(this.currentPath, name), new_name: newName }),
      });
      this.navigate(this.currentPath);
    }

    async deleteEntry(name) {
      if (!confirm(`Delete "${name}"?`)) return;
      await fetch('/api/files/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.joinPath(this.currentPath, name) }),
      });
      this.navigate(this.currentPath);
    }

    async download(names) {
      const paths = names.map(n => this.joinPath(this.currentPath, n));
      const entry = this._lastEntries.find(e => e.name === names[0]);
      const isSingleFile = names.length === 1 && entry?.type === 'file';

      if (isSingleFile) {
        const a = document.createElement('a');
        a.href = `/api/files/raw?path=${encodeURIComponent(paths[0])}`;
        a.download = names[0];
        a.click();
        return;
      }

      // multiple files or folders — zip
      const res = await fetch('/api/files/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const zipName = names.length === 1 ? names[0] : 'download';
      a.download = zipName + '.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    async compressToZip(names) {
      const paths = names.map(n => this.joinPath(this.currentPath, n));
      const defaultName = (names.length === 1 ? names[0] : 'archive') + '.zip';
      const zipName = prompt('Archive name:', defaultName);
      if (!zipName) return;
      const destPath = this.joinPath(this.currentPath, zipName.endsWith('.zip') ? zipName : zipName + '.zip');
      await fetch('/api/files/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, dest: destPath }),
      });
      this.navigate(this.currentPath);
    }

    async mkdirPrompt() {
      const name = prompt('New folder name:');
      if (!name) return;
      await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.joinPath(this.currentPath, name) }),
      });
      this.navigate(this.currentPath);
    }

    async uploadEntries(entries) {
      // collect all files recursively with their relative paths
      const collected = []; // {file, destDir}
      const readEntry = async (entry, parentDir) => {
        if (entry.isFile) {
          await new Promise(resolve => entry.file(f => { collected.push({ file: f, destDir: parentDir }); resolve(); }));
        } else if (entry.isDirectory) {
          const dir = parentDir + '/' + entry.name;
          await fetch('/api/files/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dir }),
          });
          await new Promise(r => setTimeout(r, 50)); // ensure dir exists before recursing
          const reader = entry.createReader();
          await new Promise(resolve => {
            const readAll = (results) => {
              if (!results.length) return resolve();
              Promise.all(results.map(e => readEntry(e, dir))).then(() => reader.readEntries(readAll));
            };
            reader.readEntries(readAll);
          });
        }
      };
      await Promise.all(entries.map(e => readEntry(e, this.currentPath)));
      this.uploadFileList(collected);
    }

    uploadFiles(files) {
      this.uploadFileList([...files].map(f => ({ file: f, destDir: this.currentPath })));
    }

    uploadFileList(list) {
      const MAX_SIZE = 2 * 1024 * 1024 * 1024;
      let remaining = [...list];
      const total = list.length;
      let uploaded = 0;

      const uploadNext = () => {
        if (!remaining.length) return;
        const { file, destDir } = remaining.shift();
        if (file.size > MAX_SIZE) {
          this.footerStatus.style.color = '#f38ba8';
          this.footerStatus.textContent = t('fm_file_too_large', { name: file.name });
          setTimeout(() => { this.footerStatus.textContent = ''; this.footerStatus.style.color = ''; }, 5000);
          uploadNext();
          return;
        }
        mvmOS.upload.start({
          file,
          chunkEndpoint: '/api/files/upload-chunk',
          cancelEndpoint: '/api/files/upload-chunk',
          fields: { path: destDir },
          onDone: () => {
            uploaded++;
            if (remaining.length) { uploadNext(); return; }
            this.footerStatus.style.color = '#50fa7b';
            this.footerStatus.textContent = t('fm_uploaded', { n: total, s: total > 1 ? 's' : '' });
            setTimeout(() => { this.footerStatus.textContent = ''; this.footerStatus.style.color = ''; }, 3000);
            this.navigate(this.currentPath);
          },
          onError: (msg) => {
            this.footerStatus.style.color = '#f38ba8';
            this.footerStatus.textContent = t('fm_upload_failed_file', { name: file.name, msg });
            setTimeout(() => { this.footerStatus.textContent = ''; this.footerStatus.style.color = ''; }, 5000);
            if (remaining.length) uploadNext(); else this.navigate(this.currentPath);
          },
          onCancel: () => {
            this.footerStatus.style.color = '#a6adc8';
            this.footerStatus.textContent = t('fm_upload_cancelled');
            setTimeout(() => { this.footerStatus.textContent = ''; this.footerStatus.style.color = ''; }, 3000);
          },
        });
      };
      uploadNext();
    }

    goUp() {
      if (this.currentPath === '/') return;
      const parts = this.currentPath.replace(/\/$/, '').split('/');
      parts.pop();
      this.navigate(parts.join('/') || '/');
    }

    showInfo(entry) {
      if (!entry) return;
      const isDir = entry.type === 'dir';
      const icon = isDir ? '📁' : this.fileIcon(entry.name);
      const rows = [
        [t('fm_info_name'), entry.name],
        [t('fm_info_type'), isDir ? t('fm_type_folder') : (entry.name.split('.').pop().toUpperCase() + ' file')],
        [t('fm_info_size'), isDir ? `<span id="fm-info-size">${t('fm_info_calculating')}</span>` : this.formatSize(entry.size)],
        [t('fm_info_modified'), entry.modified ? entry.modified.slice(0, 16).replace('T', ' ') : '—'],
        [t('fm_info_permissions'), entry.permissions || '—'],
        [t('fm_info_owner'), entry.owner + (entry.group ? ':' + entry.group : '')],
        [t('fm_info_path'), this.joinPath(this.currentPath, entry.name)],
      ];
      const win = document.createElement('div');
      win.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
        box-shadow:var(--shadow);z-index:99999;min-width:300px;max-width:420px;overflow:hidden;`;
      win.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--titlebar);border-bottom:1px solid var(--border);">
          <span style="font-size:.9rem;font-weight:600;">${icon} ${entry.name}</span>
          <button id="fm-info-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:1.1rem;line-height:1;">✕</button>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
          ${rows.map(([k,v]) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:7px 14px;color:var(--text-dim);white-space:nowrap;width:100px;">${k}</td>
              <td style="padding:7px 14px;word-break:break-all;">${v}</td>
            </tr>`).join('')}
          <tbody id="fm-info-extra"></tbody>
        </table>
      `;
      document.body.appendChild(win);
      win.querySelector('#fm-info-close').addEventListener('click', () => win.remove());
      const dismiss = e => { if (!win.contains(e.target)) { win.remove(); document.removeEventListener('mousedown', dismiss); } };
      setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

      const fullPath = this.joinPath(this.currentPath, entry.name);
      const ext = entry.name.split('.').pop().toLowerCase();
      const imgExts = ['jpg','jpeg','png','gif','webp','bmp','svg'];
      const audExts = ['mp3','flac','wav','aac','opus','m4a'];
      const vidExts = ['mp4','webm','ogg','mov','mkv','m4v'];

      if (!isDir && imgExts.includes(ext)) {
        const img = new Image();
        img.onload = () => {
          const el = win.querySelector('#fm-info-extra');
          if (el) el.innerHTML = `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:7px 14px;color:var(--text-dim);width:100px;">${t('fm_info_resolution')}</td>
            <td style="padding:7px 14px;">${img.naturalWidth} × ${img.naturalHeight} px</td></tr>`;
        };
        img.src = `/api/files/raw?path=${encodeURIComponent(fullPath)}`;
      } else if (!isDir && (audExts.includes(ext) || vidExts.includes(ext))) {
        const media = vidExts.includes(ext) ? document.createElement('video') : document.createElement('audio');
        media.style.cssText = 'position:fixed;left:-9999px;visibility:hidden;';
        media.preload = 'metadata';
        document.body.appendChild(media);
        media.onloadedmetadata = () => {
          const d = media.duration;
          const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = Math.floor(d % 60);
          const dur = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
          const el = win.querySelector('#fm-info-extra');
          if (el) el.innerHTML = `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:7px 14px;color:var(--text-dim);width:100px;">Duration</td>
            <td style="padding:7px 14px;">${dur}</td></tr>`;
          media.remove();
        };
        media.onerror = () => media.remove();
        media.src = `/api/files/raw?path=${encodeURIComponent(fullPath)}`;
      }

      if (isDir) {
        const fullPath = this.joinPath(this.currentPath, entry.name);
        fetch(`/api/files/dirsize?path=${encodeURIComponent(fullPath)}`)
          .then(r => r.json())
          .then(d => {
            const el = win.querySelector('#fm-info-size');
            if (el) el.textContent = this.formatSize(d.size);
          })
          .catch(() => { const el = win.querySelector('#fm-info-size'); if (el) el.textContent = '—'; });
      }
    }

    updatePreview(entry) {
      const imgExts = ['jpg','jpeg','png','gif','webp','bmp','svg'];
      if (!entry || entry.type === 'dir' || !imgExts.includes(entry.name.split('.').pop().toLowerCase())) {
        if (!this._previewClosed) this.previewEl.style.display = 'none';
        this.previewImg.src = '';
        return;
      }
      const fullPath = this.joinPath(this.currentPath, entry.name);
      this._previewClosed = false;
      this.previewEl.style.display = '';
      this.previewImg.src = `/api/files/raw?path=${encodeURIComponent(fullPath)}`;
      this.previewName.textContent = entry.name;
      this.previewMeta.textContent = this.formatSize(entry.size);
      this.previewImg.onload = () => {
        this.previewMeta.textContent = `${this.formatSize(entry.size)} · ${this.previewImg.naturalWidth}×${this.previewImg.naturalHeight}`;
      };
    }

    updateFooterSelection() {
      if (this.progressWrap.style.display !== 'none') return;
      const names = [...this.selectedSet];
      if (names.length === 0) { this.footerStatus.textContent = ''; return; }
      const entries = (this._lastEntries || []).filter(e => names.includes(e.name));
      const dirs = entries.filter(e => e.type === 'dir').length;
      const files = entries.filter(e => e.type !== 'dir');
      const totalSize = files.reduce((s, e) => s + (e.size || 0), 0);
      const parts = [];
      if (dirs > 0) parts.push(t('fm_folder_count', {n: dirs, s: dirs > 1 ? 's' : ''}));
      if (files.length > 0) parts.push(t('fm_file_count', {n: files.length, s: files.length > 1 ? 's' : ''}));
      if (totalSize > 0) parts.push(this.formatSize(totalSize));
      this.footerStatus.textContent = parts.join(' · ');
    }

    joinPath(base, name) {
      return (base.endsWith('/') ? base : base + '/') + name;
    }

    showError(msg) {
      this.listEl.innerHTML = `<div class="fm-empty" style="color:#e05555">${msg}</div>`;
    }

    formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    fileIcon(name) {
      const ext = name.split('.').pop().toLowerCase();
      const map = { js: '📜', py: '🐍', sh: '⚙️', txt: '📄', md: '📝', json: '📋',
                    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
                    pdf: '📕', zip: '🗜️', tar: '🗜️', gz: '🗜️', rar: '🗜️', '7z': '🗜️', bz2: '🗜️', xz: '🗜️', mp4: '🎬', mp3: '🎵',
                    url: '🔗', mvmos: '🚀' };
      return map[ext] || '📄';
    }
  }

  function deleteDialog(count) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:280px;max-width:360px;box-shadow:var(--shadow)">
          <div style="font-size:1rem;margin-bottom:16px;">${t('fm_delete_title').replace('{n}', count)}</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button id="del-trash" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:var(--text);cursor:pointer;text-align:left;">${t('fm_delete_to_trash')}</button>
            <button id="del-perm" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:#e05555;cursor:pointer;text-align:left;">${t('fm_delete_permanent')}</button>
            <button id="del-cancel" style="background:transparent;border:none;padding:6px;color:var(--text-dim);cursor:pointer;">${t('fm_delete_cancel')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#del-trash').addEventListener('click',  () => { overlay.remove(); resolve('trash'); });
      overlay.querySelector('#del-perm').addEventListener('click',   () => { overlay.remove(); resolve('permanent'); });
      overlay.querySelector('#del-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    });
  }

  return { openWindow, deleteDialog };
})();
