// ── File Manager window ──────────────────────────────────────────────────────

const FileManager = (() => {
  let fmCount = 0;

  function openWindow() {
    fmCount++;
    const id = 'filemanager-' + fmCount;

    Desktop.createWindow({
      id,
      title: 'File Manager',
      width: 680,
      height: 480,
      onMount(body) {
        const fm = new FMInstance(body);
        fm.navigate('/');
      },
    });
  }

  class FMInstance {
    constructor(body) {
      this.body = body;
      this.currentPath = '/';
      this.selected = null;

      body.innerHTML = `
        <div class="fm-container">
          <div class="fm-toolbar">
            <button class="fm-up">↑ Up</button>
            <button class="fm-home">⌂ Home</button>
            <span class="fm-breadcrumb">/</span>
            <button class="fm-mkdir">+ Folder</button>
            <button class="fm-upload-btn">↑ Upload</button>
            <input type="file" class="fm-upload-input" style="display:none" multiple>
          </div>
          <div class="fm-list"></div>
        </div>
      `;

      this.listEl   = body.querySelector('.fm-list');
      this.breadEl  = body.querySelector('.fm-breadcrumb');

      body.querySelector('.fm-up').addEventListener('click', () => this.goUp());
      body.querySelector('.fm-home').addEventListener('click', () => this.navigate('/'));
      body.querySelector('.fm-mkdir').addEventListener('click', () => this.mkdirPrompt());

      const uploadBtn   = body.querySelector('.fm-upload-btn');
      const uploadInput = body.querySelector('.fm-upload-input');
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => this.uploadFiles(uploadInput.files));

      // right-click context menu on list
      this.listEl.addEventListener('contextmenu', e => this.onContextMenu(e));
    }

    async navigate(path) {
      this.currentPath = path;
      this.breadEl.textContent = path;
      this.selected = null;

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
      if (entries.length === 0) {
        this.listEl.innerHTML = '<div class="fm-empty">Empty folder</div>';
        return;
      }

      this.listEl.innerHTML = '';
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'fm-entry';
        row.dataset.name = entry.name;
        row.dataset.type = entry.type;

        const icon = entry.type === 'dir' ? '📁' : this.fileIcon(entry.name);
        const size = entry.type === 'dir' ? '—' : this.formatSize(entry.size);
        const date = entry.modified ? entry.modified.slice(0, 16).replace('T', ' ') : '';

        row.innerHTML = `
          <span class="fm-icon">${icon}</span>
          <span class="fm-name">${entry.name}</span>
          <span class="fm-size">${size}</span>
          <span class="fm-date">${date}</span>
        `;

        row.addEventListener('click', () => {
          this.listEl.querySelectorAll('.fm-entry').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          this.selected = entry;
        });

        if (entry.type === 'dir') {
          row.addEventListener('dblclick', () => {
            this.navigate(this.joinPath(this.currentPath, entry.name));
          });
        }

        this.listEl.appendChild(row);
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
      return (base === '/' ? '' : base) + '/' + name;
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
