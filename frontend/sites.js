const Sites = (() => {
  let _win = null;

  function t(k) { return window.t?.(k) || k; }

  async function openWindow() {
    if (_win && document.body.contains(_win)) {
      _win.dispatchEvent(new CustomEvent('focus-window'));
      return;
    }
    _win = Desktop.createWindow({
      id: 'sites',
      title: t('app_msc'),
      icon: '🌐',
      width: 680,
      height: 540,
      onMount: _mount,
    });
  }

  async function _mount(el) {
    _render(el);
  }

  function _render(el) {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;">
          <div style="font-size:.95rem;font-weight:600;">${t('sites_projects')}</div>
          <div style="display:flex;gap:6px">
            <button class="s-btn" id="sites-webserver-btn" style="font-size:.8rem">⏸ Web Server</button>
            <button class="s-btn" id="sites-new-btn" style="background:var(--accent);color:#fff;border-color:var(--accent);">+ ${t('sites_new_project')}</button>
          </div>
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
              <span id="sites-id-preview" style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">→ /my-blog</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <label style="width:100px;font-size:.82rem;color:var(--text-dim);flex-shrink:0">${t('sites_address_type')}</label>
              <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer">
                <input type="radio" name="sites-addr-type" value="path" checked> ${t('sites_path')}
              </label>
              <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer">
                <input type="radio" name="sites-addr-type" value="domain"> ${t('sites_domain')}
              </label>
            </div>
            <div id="sites-domain-row" style="display:none;flex-direction:row;gap:8px;align-items:center;">
              <label style="width:100px;font-size:.82rem;color:var(--text-dim);flex-shrink:0">${t('sites_domain')}</label>
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

    const nameEl = el.querySelector('#sites-name');
    const idEl = el.querySelector('#sites-id');
    const idPreview = el.querySelector('#sites-id-preview');

    nameEl.addEventListener('input', () => {
      if (!idEl._touched) {
        idEl.value = nameEl.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        idPreview.textContent = '→ /' + (idEl.value || 'my-blog');
      }
    });
    idEl.addEventListener('input', () => {
      idEl._touched = true;
      idPreview.textContent = '→ /' + (idEl.value || 'my-blog');
    });

    el.querySelectorAll('input[name="sites-addr-type"]').forEach(r => {
      r.addEventListener('change', () => {
        const domainRow = el.querySelector('#sites-domain-row');
        domainRow.style.display = r.value === 'domain' ? 'flex' : 'none';
      });
    });

    el.querySelector('#sites-webserver-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#sites-webserver-btn');
      const s = await fetch('/api/projects/webserver/status').then(r => r.json());
      if (s.active) _stopWebServer(el);
      else _startWebServer(el);
    });

    el.querySelector('#sites-new-btn').addEventListener('click', () => {
      el.querySelector('#sites-form').style.display = '';
      nameEl.focus();
    });
    el.querySelector('#sites-cancel-btn').addEventListener('click', () => _resetForm(el));
    el.querySelector('#sites-create-btn').addEventListener('click', () => _createProject(el));

    _loadWebServerStatus(el);
    _loadProjects(el);
  }

  async function _loadWebServerStatus(el) {
    const btn = el.querySelector('#sites-webserver-btn');
    if (!btn) return;
    try {
      const s = await fetch('/api/projects/webserver/status').then(r => r.json());
      btn._wsActive = s.active;
      if (s.active) {
        btn.textContent = `🟢 Web Server :${s.port}`;
        btn.style.cssText = 'font-size:.8rem;color:#50fa7b;border-color:#50fa7b';
      } else {
        btn.textContent = '⏸ Web Server';
        btn.style.cssText = 'font-size:.8rem';
      }
    } catch {
      btn._wsActive = false;
      btn.textContent = '⏸ Web Server';
    }
  }

  function _startWebServer(el) {
    const existing = el.querySelector('#sites-webserver-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'sites-webserver-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100;border-radius:var(--radius)';
    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;width:300px;display:flex;flex-direction:column;gap:12px">
        <div style="font-weight:600;font-size:.9rem">🌐 Web Server</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:.82rem;color:var(--text-dim)">Port</label>
          <input id="ws-port" class="s-input" type="number" value="80" min="1" max="65535">
        </div>
        <div id="ws-error" style="display:none;font-size:.78rem;color:#ff5555"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="s-btn" id="ws-cancel">${t('cancel')}</button>
          <button class="s-btn" id="ws-start" style="background:var(--accent);color:#fff;border-color:var(--accent)">Start</button>
        </div>
      </div>`;
    el.style.position = 'relative';
    el.appendChild(modal);
    modal.querySelector('#ws-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#ws-start').addEventListener('click', async () => {
      const port = parseInt(modal.querySelector('#ws-port').value);
      if (!port) return;
      modal.querySelector('#ws-start').disabled = true;
      const res = await fetch('/api/projects/webserver/start', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ port }),
      });
      const d = await res.json();
      if (!res.ok) {
        modal.querySelector('#ws-start').disabled = false;
        const errEl = modal.querySelector('#ws-error');
        errEl.textContent = d.detail || d.error || 'Error';
        errEl.style.display = 'block';
        return;
      }
      modal.remove();
      await _loadWebServerStatus(el);
    });
  }

  async function _stopWebServer(el) {
    const btn = el.querySelector('#sites-webserver-btn');
    btn.disabled = true;
    const res = await fetch('/api/projects/webserver/stop', { method: 'POST' });
    btn.disabled = false;
    btn._wsActive = false;
    await _loadWebServerStatus(el);
  }

  function _resetForm(el) {
    el.querySelector('#sites-form').style.display = 'none';
    el.querySelector('#sites-name').value = '';
    el.querySelector('#sites-id').value = '';
    el.querySelector('#sites-id')._touched = false;
    el.querySelector('#sites-domain').value = '';
    el.querySelector('#sites-id-preview').textContent = '→ /my-blog';
    el.querySelector('#sites-domain-row').style.display = 'none';
    el.querySelectorAll('input[name="sites-addr-type"]').forEach(r => r.checked = r.value === 'path');
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
        const pathUrl = `${location.origin}/${p.id}`;
        const domainUrl = p.domain ? `https://${p.domain}` : null;
        const displayUrl = domainUrl || pathUrl;
        return `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <label style="display:flex;align-items:center;cursor:pointer;flex-shrink:0" title="${t('sites_toggle')}">
                <input type="checkbox" class="sites-toggle" data-id="${p.id}" ${p.watching || p.published ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
              </label>
              <span style="font-size:1.1rem">🌐</span>
              <span style="font-size:.9rem;font-weight:600">${p.name}</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              ${p.has_app ? `<button class="s-btn sites-open-app" data-id="${p.id}" style="padding:3px 10px;font-size:.78rem">▶ ${t('sites_open_app')}</button>` : ''}
              ${watching
                ? `<span style="font-size:.72rem;color:#50fa7b;background:rgba(80,250,123,.1);border:1px solid rgba(80,250,123,.3);border-radius:4px;padding:2px 7px">● ${t('sites_watching')}</span>
                   <button class="s-btn sites-stop" data-id="${p.id}" style="padding:3px 10px;font-size:.78rem">${t('sites_stop')}</button>`
                : `<button class="s-btn sites-build" data-id="${p.id}" style="background:var(--accent);color:#fff;border-color:var(--accent);padding:3px 10px;font-size:.78rem">${t('sites_build')}</button>`
              }
              <button class="s-btn sites-edit" data-id="${p.id}" data-dir="${p.project_dir}" style="padding:3px 10px;font-size:.78rem">✏️ ${t('sites_edit')}</button>
              <button class="s-btn sites-settings" data-id="${p.id}" data-name="${p.name}" data-domain="${p.domain || ''}" data-path="${p.path || ''}" style="padding:3px 10px;font-size:.78rem">⚙ ${t('settings')}</button>
              <button class="s-btn sites-del" data-id="${p.id}" style="color:#ff5555;border-color:#ff5555;padding:3px 8px;font-size:.78rem">✕</button>
            </div>
            <div style="font-size:.75rem;color:var(--text-dim);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
              <a href="${displayUrl}" target="_blank" style="color:var(--accent);text-decoration:none">🔗 ${displayUrl}</a>
              <span class="sites-open-dir" data-path="${p.project_dir}" style="cursor:pointer;color:var(--text-dim)">📂 ${p.project_dir}</span>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.sites-open-app').forEach(btn => {
        btn.addEventListener('click', async () => {
          await mvmOS._loadPlugin(btn.dataset.id);
          Desktop.openApp(btn.dataset.id);
        });
      });
      list.querySelectorAll('.sites-toggle').forEach(cb => {
        cb.addEventListener('change', async () => {
          const endpoint = cb.checked ? 'publish' : 'unpublish';
          await fetch(`/api/projects/${cb.dataset.id}/${endpoint}`, { method: 'POST' });
          await _loadProjects(el);
        });
      });
      list.querySelectorAll('.sites-open-dir').forEach(d => {
        d.addEventListener('click', () => FileManager.openWindow(d.dataset.path));
      });
      list.querySelectorAll('.sites-edit').forEach(btn => {
        btn.addEventListener('click', () => CodeEditor.openWindow(btn.dataset.id, btn.dataset.dir));
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
      list.querySelectorAll('.sites-settings').forEach(btn => {
        btn.addEventListener('click', () => _openSettings(el, btn.dataset.id, btn.dataset.name, btn.dataset.domain, btn.dataset.path));
      });
    } catch {
      list.innerHTML = `<div style="color:#ff5555;font-size:.82rem">${t('error')}</div>`;
    }
  }

  async function _createProject(el) {
    const name   = el.querySelector('#sites-name').value.trim();
    const id     = el.querySelector('#sites-id').value.trim();
    const useDomain = el.querySelector('input[name="sites-addr-type"]:checked').value === 'domain';
    const domain = el.querySelector('#sites-domain').value.trim();
    const btn    = el.querySelector('#sites-create-btn');

    if (!name) { alert(t('sites_project_name_required')); return; }
    if (!id)   { alert(t('sites_project_id_required')); return; }
    if (useDomain && !domain) { alert(t('sites_domain_required') || 'Enter a domain.'); return; }

    btn.disabled = true;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, use_domain: useDomain, domain: domain || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || t('error')); return; }
      _resetForm(el);
      await _loadProjects(el);
    } catch {
      alert(t('error'));
    } finally {
      btn.disabled = false;
    }
  }

  function _openSettings(el, id, name, domain, path) {
    const existing = el.querySelector('#sites-settings-modal');
    if (existing) existing.remove();

    const useDomain = !!domain;
    const modal = document.createElement('div');
    modal.id = 'sites-settings-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100;border-radius:var(--radius)';
    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;width:380px;display:flex;flex-direction:column;gap:12px">
        <div style="font-weight:600;font-size:.9rem">${t('settings')} — ${name}</div>
        <div style="display:flex;gap:12px;align-items:center">
          <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer">
            <input type="radio" name="cfg-addr-type" value="path" ${!useDomain ? 'checked' : ''}> ${t('sites_path')}
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer">
            <input type="radio" name="cfg-addr-type" value="domain" ${useDomain ? 'checked' : ''}> ${t('sites_domain')}
          </label>
        </div>
        <div id="cfg-domain-row" style="display:${useDomain ? 'flex' : 'none'};flex-direction:column;gap:4px">
          <label style="font-size:.82rem;color:var(--text-dim)">${t('sites_domain')}</label>
          <input id="cfg-domain" class="s-input" placeholder="example.com" value="${domain}">
        </div>
        <div id="cfg-path-row" style="display:${!useDomain ? 'flex' : 'none'};flex-direction:column;gap:4px">
          <label style="font-size:.82rem;color:var(--text-dim)">${t('sites_path')}</label>
          <input id="cfg-path" class="s-input" placeholder="/my-site" value="${path || '/' + id}">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="s-btn" id="cfg-cancel">${t('cancel')}</button>
          <button class="s-btn" id="cfg-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${t('save')}</button>
        </div>
      </div>`;

    el.style.position = 'relative';
    el.appendChild(modal);

    modal.querySelectorAll('input[name="cfg-addr-type"]').forEach(r => {
      r.addEventListener('change', () => {
        modal.querySelector('#cfg-domain-row').style.display = r.value === 'domain' ? 'flex' : 'none';
        modal.querySelector('#cfg-path-row').style.display = r.value === 'path' ? 'flex' : 'none';
      });
    });

    modal.querySelector('#cfg-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#cfg-save').addEventListener('click', async () => {
      const useD = modal.querySelector('input[name="cfg-addr-type"]:checked').value === 'domain';
      const d = modal.querySelector('#cfg-domain').value.trim();
      const p = modal.querySelector('#cfg-path').value.trim().replace(/^([^/])/, '/$1');
      if (useD && !d) { alert(t('sites_domain_required') || 'Enter a domain.'); return; }
      if (!useD && !p) { alert(t('sites_path_required') || 'Enter a path.'); return; }
      const saveBtn = modal.querySelector('#cfg-save');
      saveBtn.disabled = true;
      const res = await fetch(`/api/projects/${id}/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_domain: useD, domain: d || null, path: p || null }),
      });
      if (res.ok) {
        modal.remove();
        await _loadProjects(el);
      } else {
        const data = await res.json();
        alert(data.detail || t('error'));
        saveBtn.disabled = false;
      }
    });
  }

  return { openWindow };
})();
