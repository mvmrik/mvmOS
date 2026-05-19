const Sites = (() => {
  let _win = null;
  let _showForm = false;

  function t(k) { return window.t?.(k) || k; }

  async function openWindow() {
    if (_win && document.body.contains(_win)) {
      _win.dispatchEvent(new CustomEvent('focus-window'));
      return;
    }
    _win = Desktop.createWindow({
      id: 'sites',
      title: t('app_sites'),
      icon: '🌐',
      width: 660,
      height: 520,
      onMount: _mount,
    });
  }

  async function _mount(el) {
    _showForm = false;
    _render(el);
  }

  function _render(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;">
          <div style="font-size:.95rem;font-weight:600;">${t('sites_projects')}</div>
          <button class="s-btn" id="sites-new-btn" style="background:var(--accent);color:#fff;border-color:var(--accent);">+ ${t('sites_new_project')}</button>
        </div>

        <div id="sites-form" style="display:none;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:14px 16px;background:var(--surface2);">
          <div style="font-weight:600;font-size:.85rem;margin-bottom:12px;">${t('sites_new_project')}</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <label style="width:100px;font-size:.82rem;color:var(--text-dim);flex-shrink:0">${t('sites_project_name')}</label>
              <input id="sites-name" class="s-input" style="flex:1" placeholder="${t('sites_project_name_ph')}">
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <label style="width:100px;font-size:.82rem;color:var(--text-dim);flex-shrink:0">${t('sites_project_id')}</label>
              <input id="sites-id" class="s-input" style="flex:1" placeholder="my-blog">
              <span style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">→ /my-blog</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <label style="width:100px;font-size:.82rem;color:var(--text-dim);flex-shrink:0">${t('sites_domain')} <span style="opacity:.5">(${t('optional')})</span></label>
              <input id="sites-domain" class="s-input" style="flex:1" placeholder="example.com">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
              <button class="s-btn" id="sites-cancel-btn">${t('cancel')}</button>
              <button class="s-btn" id="sites-create-btn" style="background:var(--accent);color:#fff;border-color:var(--accent);">${t('sites_create')}</button>
            </div>
          </div>
        </div>

        <div id="sites-list" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;"></div>
      </div>`;

    // auto-fill id from name
    const nameEl = el.querySelector('#sites-name');
    const idEl = el.querySelector('#sites-id');
    nameEl.addEventListener('input', () => {
      if (!idEl._touched) {
        idEl.value = nameEl.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      }
    });
    idEl.addEventListener('input', () => { idEl._touched = true; });

    el.querySelector('#sites-new-btn').addEventListener('click', () => {
      el.querySelector('#sites-form').style.display = '';
      nameEl.focus();
    });
    el.querySelector('#sites-cancel-btn').addEventListener('click', () => {
      el.querySelector('#sites-form').style.display = 'none';
      nameEl.value = ''; idEl.value = ''; idEl._touched = false;
      el.querySelector('#sites-domain').value = '';
    });
    el.querySelector('#sites-create-btn').addEventListener('click', () => _createProject(el));

    _loadProjects(el);
  }

  async function _loadProjects(el) {
    const list = el.querySelector('#sites-list');
    list.innerHTML = `<div style="color:var(--text-dim);font-size:.82rem">${t('loading')}</div>`;
    try {
      const projects = await fetch('/api/projects').then(r => r.json());
      if (!projects.length) {
        list.innerHTML = `<div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${t('sites_empty')}</div>`;
        return;
      }
      list.innerHTML = projects.map(p => {
        const watching = p.watching;
        const url = `${location.origin}/${p.id}`;
        const domainUrl = p.domain ? `https://${p.domain}` : null;
        return `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <label style="display:flex;align-items:center;cursor:pointer;flex-shrink:0" title="${t('sites_toggle')}">
                <input type="checkbox" class="sites-toggle" data-id="${p.id}" ${p.watching || p.published ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
              </label>
              <span style="font-size:1.2rem">🌐</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:.9rem;font-weight:600">${p.name}</div>
                <div style="display:flex;gap:10px;margin-top:2px;flex-wrap:wrap;">
                  <a href="${url}" target="_blank" style="font-size:.75rem;color:var(--accent);text-decoration:none">${url}</a>
                  ${domainUrl ? `<a href="${domainUrl}" target="_blank" style="font-size:.75rem;color:var(--accent);text-decoration:none">${domainUrl}</a>` : ''}
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                ${p.has_app ? `<button class="s-btn sites-open-app" data-id="${p.id}" style="padding:3px 10px;font-size:.78rem">▶ ${t('sites_open_app')}</button>` : ''}
                ${watching
                  ? `<span style="font-size:.72rem;color:#50fa7b;background:rgba(80,250,123,.1);border:1px solid rgba(80,250,123,.3);border-radius:4px;padding:2px 7px">● ${t('sites_watching')}</span>
                     <button class="s-btn sites-stop" data-id="${p.id}" style="padding:3px 10px;font-size:.78rem">${t('sites_stop')}</button>`
                  : `<button class="s-btn sites-build" data-id="${p.id}" style="background:var(--accent);color:#fff;border-color:var(--accent);padding:3px 10px;font-size:.78rem">${t('sites_build')}</button>`
                }
                <button class="s-btn sites-del" data-id="${p.id}" style="color:#ff5555;border-color:#ff5555;padding:3px 8px;font-size:.78rem">✕</button>
              </div>
            </div>
            <div style="font-size:.75rem;color:var(--text-dim);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);cursor:pointer;" class="sites-open-dir" data-path="${p.project_dir}">
              📂 ${p.project_dir}
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.sites-open-app').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          // ensure app is loaded before opening
          await mvmOS._loadPlugin(id);
          Desktop.openApp(id);
        });
      });
      list.querySelectorAll('.sites-toggle').forEach(cb => {
        cb.addEventListener('change', async () => {
          const endpoint = cb.checked ? 'publish' : 'unpublish';
          await fetch(`/api/projects/${cb.dataset.id}/${endpoint}`, { method: 'POST' });
          await _loadProjects(el);
        });
      });
      list.querySelectorAll('.sites-open-dir').forEach(el => {
        el.addEventListener('click', () => FileManager.openWindow(el.dataset.path));
      });
      list.querySelectorAll('.sites-build').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await fetch(`/api/projects/${btn.dataset.id}/build`, { method: 'POST' });
          await _loadProjects(el);
        });
      });
      list.querySelectorAll('.sites-stop').forEach(btn => {
        btn.addEventListener('click', async () => {
          await fetch(`/api/projects/${btn.dataset.id}/stop`, { method: 'POST' });
          await _loadProjects(el);
        });
      });
      list.querySelectorAll('.sites-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('sites_confirm_delete'))) return;
          await fetch(`/api/projects/${btn.dataset.id}`, { method: 'DELETE' });
          await _loadProjects(el);
        });
      });
    } catch {
      list.innerHTML = `<div style="color:#ff5555;font-size:.82rem">${t('error')}</div>`;
    }
  }

  async function _createProject(el) {
    const name   = el.querySelector('#sites-name').value.trim();
    const id     = el.querySelector('#sites-id').value.trim();
    const domain = el.querySelector('#sites-domain').value.trim();
    const btn    = el.querySelector('#sites-create-btn');

    if (!name) { alert(t('sites_project_name_required')); return; }
    if (!id)   { alert(t('sites_project_id_required')); return; }

    btn.disabled = true;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, domain: domain || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || t('error')); return; }
      el.querySelector('#sites-form').style.display = 'none';
      el.querySelector('#sites-name').value = '';
      el.querySelector('#sites-id').value = '';
      el.querySelector('#sites-domain').value = '';
      el.querySelector('#sites-id')._touched = false;
      await _loadProjects(el);
    } catch {
      alert(t('error'));
    } finally {
      btn.disabled = false;
    }
  }

  return { openWindow };
})();
