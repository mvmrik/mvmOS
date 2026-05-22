// ── FolderPicker ──────────────────────────────────────────────────────────────
// Usage: FolderPicker.open({ root: '/home/user', onSelect: (path) => {} })

const FolderPicker = (() => {

  async function _listFolders(path, asRoot) {
    try {
      const url = `/api/files?path=${encodeURIComponent(path)}${asRoot ? '&as_root=true' : ''}`;
      const r = await fetch(url);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.entries || []).filter(e => (e.is_dir || e.type === 'dir') && !e.name.startsWith('.')).map(e => e.name).sort();
    } catch { return []; }
  }

  function open({ root, onSelect, title, asRoot }) {
    const existing = document.getElementById('fp-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'fp-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(420px,90vw);max-height:70vh;display:flex;flex-direction:column;box-shadow:var(--shadow)';

    let currentPath = root;

    function _pathParts(path) {
      const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
      const crumbs = [{ label: '~', path: root }];
      let acc = root;
      // build crumbs relative to root
      const rootParts = root.replace(/\/+$/, '').split('/').filter(Boolean);
      for (let i = rootParts.length; i < parts.length; i++) {
        acc += '/' + parts[i];
        crumbs.push({ label: parts[i], path: acc });
      }
      return crumbs;
    }

    async function _render() {
      const folders = await _listFolders(currentPath, asRoot);
      const crumbs = _pathParts(currentPath);

      modal.innerHTML = `
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="flex:1;font-weight:600;font-size:.95rem">${title || (window._i18n?.fp_title || 'Select Folder')}</span>
          <button id="fp-close" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-dim)">✕</button>
        </div>
        <div id="fp-breadcrumb" style="padding:8px 16px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--border);font-size:.82rem"></div>
        <div id="fp-list" style="overflow-y:auto;flex:1;padding:6px 0;min-height:80px"></div>
        <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
          <button class="s-btn" id="fp-cancel">${window._i18n?.cancel || 'Cancel'}</button>
          <button class="s-btn" id="fp-select" style="background:var(--accent);color:#fff;border-color:var(--accent)">${window._i18n?.fp_select || 'Select'}</button>
        </div>
      `;

      // breadcrumb
      const bc = modal.querySelector('#fp-breadcrumb');
      crumbs.forEach((c, i) => {
        const span = document.createElement('span');
        if (i < crumbs.length - 1) {
          span.innerHTML = `<a href="#" style="color:var(--accent);text-decoration:none">${c.label}</a><span style="color:var(--text-dim);margin:0 2px">/</span>`;
          span.querySelector('a').addEventListener('click', e => { e.preventDefault(); currentPath = c.path; _render(); });
        } else {
          span.textContent = c.label;
          span.style.color = 'var(--text)';
          span.style.fontWeight = '500';
        }
        bc.appendChild(span);
      });

      // folder list
      const list = modal.querySelector('#fp-list');
      if (!folders.length) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:.85rem">${window._i18n?.fp_empty || 'No subfolders'}</div>`;
      } else {
        folders.forEach(name => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 16px;cursor:pointer;font-size:.88rem';
          row.innerHTML = `<span style="font-size:1rem">📁</span><span>${name}</span>`;
          row.addEventListener('mouseenter', () => row.style.background = 'var(--hover)');
          row.addEventListener('mouseleave', () => row.style.background = '');
          row.addEventListener('click', () => { currentPath = currentPath.replace(/\/+$/, '') + '/' + name; _render(); });
          list.appendChild(row);
        });
      }

      modal.querySelector('#fp-close').addEventListener('click', () => ov.remove());
      modal.querySelector('#fp-cancel').addEventListener('click', () => ov.remove());
      modal.querySelector('#fp-select').addEventListener('click', () => {
        ov.remove();
        onSelect(currentPath);
      });
    }

    ov.appendChild(modal);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    _render();
  }

  return { open };
})();
