// ── File Manager window ──────────────────────────────────────────────────────

const FileManager = (() => {
  let fmCount = 0;

  function loadPrefs() { return Settings.loadFMPrefs(); }

  function openWindow() {
    fmCount++;
    const id = 'filemanager-' + fmCount;

    Desktop.createWindow({
      id,
      title: '📁 File Manager',
      width: 720,
      height: 480,
      appSettings: 'filemanager',
      onMount(body) {
        const fm = new FMInstance(body);
        fetch('/api/files/places').then(r => r.json()).then(d => fm.navigate(d.home)).catch(() => fm.navigate('/'));
      },
    });
  }

  class FMInstance {
    constructor(body) {
      this.body = body;
      this.currentPath = '/';
      this.selected = null;
      window.addEventListener('fm-prefs-changed', () => this.navigate(this.currentPath));

      body.innerHTML = `
        <div class="fm-container">
          <div class="fm-toolbar">
            <button class="fm-up">↑ Up</button>
            <span class="fm-breadcrumb"></span>
            <button class="fm-mkdir">+ Folder</button>
            <button class="fm-upload-btn">↑ Upload</button>
            <input type="file" class="fm-upload-input" style="display:none" multiple>
          </div>
          <div class="fm-body">
            <nav class="fm-places"></nav>
            <div class="fm-list"></div>
          </div>
        </div>
      `;

      this.listEl   = body.querySelector('.fm-list');
      this.breadEl  = body.querySelector('.fm-breadcrumb');
      this.placesEl = body.querySelector('.fm-places');

      body.querySelector('.fm-up').addEventListener('click', () => this.goUp());
      body.querySelector('.fm-mkdir').addEventListener('click', () => this.mkdirPrompt());

      this.loadPlaces();

      const uploadBtn   = body.querySelector('.fm-upload-btn');
      const uploadInput = body.querySelector('.fm-upload-input');
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => this.uploadFiles(uploadInput.files));

      // right-click context menu on list
      this.listEl.addEventListener('contextmenu', e => this.onContextMenu(e));
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
        this._addPlace('🏠', 'Home', data.home);

        // XDG folders (only if exist)
        if (data.xdg.length > 0) {
          const sep = document.createElement('div');
          sep.className = 'fm-places-sep';
          this.placesEl.appendChild(sep);
          data.xdg.forEach(p => this._addPlace(p.icon, p.name, p.path));
        }

        // separator + Computer
        const sep2 = document.createElement('div');
        sep2.className = 'fm-places-sep';
        this.placesEl.appendChild(sep2);
        this._addPlace('💻', 'Computer', '/');

        this.updateActivePlacea(this.currentPath);
      } catch (_) {}
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
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:.85rem;';
        item.textContent = '⬛ Open in Terminal';
        item.addEventListener('mouseenter', () => item.style.background = 'var(--surface2)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', () => {
          menu.remove();
          Terminal.openWindow();
          setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: `cd ${path}` })), 500);
        });
        menu.appendChild(item);
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

    async navigate(path) {
      this.currentPath = path;
      this.selected = null;
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
      this.updateActivePlacea(path);

      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        if (!res.ok) { this.showError('Cannot read directory'); return; }
        const data = await res.json();
        this.render(data.entries);
      } catch (e) {
        this.showError('Network error');
      }
    }

    render(entries) {
      this._lastEntries = entries;
      if (!loadPrefs().showHidden) entries = entries.filter(e => !e.name.startsWith('.'));
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

        const permsHtml = prefs.showPerms
          ? `<span class="fm-perms fm-editable" title="Click to change">${entry.permissions || ''}</span>` : '';
        const ownerHtml = prefs.showOwner
          ? `<span class="fm-owner fm-editable" title="Click to change">${entry.owner || ''}${entry.group ? ':'+entry.group : ''}</span>` : '';

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
          this.listEl.querySelectorAll('.fm-entry').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          this.selected = entry;
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
            if (ImageViewer.isImage(entry.name)) {
              ImageViewer.openWindow(fullPath, this._lastEntries);
            } else if (VideoPlayer.isVideo(entry.name) || VideoPlayer.isAudio(entry.name)) {
              VideoPlayer.openWindow(fullPath);
            }
          });
        }

        if (prefs.showPerms) {
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

        if (prefs.showOwner) {
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
        items.push({ label: '✏️ Rename', action: () => this.renamePrompt(name) });
        items.push({ label: '🗑️ Delete', action: () => this.deleteEntry(name), danger: true });
      } else {
        items.push({ label: '⬛ Open in Terminal', action: () => {
          Terminal.openWindow();
          setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: `cd ${this.currentPath}` })), 500);
        }});
      }
      items.push({ label: '📁 New Folder', action: () => this.mkdirPrompt() });
      items.push({ label: '🔄 Refresh', action: () => this.navigate(this.currentPath) });

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

    async uploadFiles(files) {
      for (const file of files) {
        const form = new FormData();
        form.append('path', this.currentPath);
        form.append('file', file);
        await fetch('/api/files/upload', { method: 'POST', body: form });
      }
      this.navigate(this.currentPath);
    }

    goUp() {
      if (this.currentPath === '/') return;
      const parts = this.currentPath.replace(/\/$/, '').split('/');
      parts.pop();
      this.navigate(parts.join('/') || '/');
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
                    pdf: '📕', zip: '📦', tar: '📦', gz: '📦', mp4: '🎬', mp3: '🎵' };
      return map[ext] || '📄';
    }
  }

  return { openWindow };
})();
