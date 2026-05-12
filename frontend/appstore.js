// ── App Store ────────────────────────────────────────────────────────────────

const AppStore = (() => {

  function openWindow(tab) {
    const existing = document.querySelector('.window[data-win-id="appstore"]');
    if (existing) {
      Desktop.focusWindow('appstore');
      if (tab) _switchTab(existing, tab);
      return;
    }
    Desktop.createWindow({
      id: 'appstore',
      title: '📦 App Store',
      width: 820,
      height: 560,
      onMount(body) { render(body); if (tab) _switchTab(body.closest('.window'), tab); },
    });
  }

  function _switchTab(winEl, tab) {
    const body = winEl?.querySelector?.('.window-body') ?? winEl;
    const tabEl = body?.querySelector?.(`.as-tab[data-tab="${tab}"]`);
    tabEl?.click();
  }

  function render(body) {
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="as-wrap">
        <nav class="as-sidebar">
          <div class="as-tab active" data-tab="browse">🗂️ Browse</div>
          <div class="as-tab" data-tab="installed">✅ Installed</div>
          <div class="as-tab" data-tab="search">🔍 Search</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-tab" data-tab="mvmos">⚡ mvmOS Apps</div>
        </nav>
        <div class="as-main">

          <!-- Browse -->
          <div class="as-panel active" id="asp-browse">
            <div class="as-list as-cat-grid" id="as-cat-grid"><div class="as-loading">Loading categories…</div></div>
            <div class="as-browse-pkg" id="as-browse-pkg" style="display:none">
              <div class="as-toolbar">
                <button class="s-btn-sm" id="as-back">← Back</button>
                <span id="as-browse-title" style="font-size:.85rem;font-weight:600;flex:1;padding-left:8px"></span>
                <input class="as-filter" id="as-browse-filter" placeholder="Filter…" style="max-width:160px">
              </div>
              <div class="as-list" id="as-browse-list"></div>
              <div class="as-pagination" id="as-pagination"></div>
            </div>
          </div>

          <!-- Installed -->
          <div class="as-panel" id="asp-installed">
            <div class="as-toolbar">
              <input class="as-filter" id="as-installed-filter" placeholder="Filter installed…">
              <button class="s-btn" id="as-refresh">↺</button>
            </div>
            <div class="as-list" id="as-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Search -->
          <div class="as-panel" id="asp-search">
            <div class="as-toolbar">
              <input class="as-filter" id="as-search-input" placeholder="Search all packages…">
              <button class="s-btn" id="as-search-btn">Search</button>
            </div>
            <div class="as-list" id="as-search-list"><div class="as-loading">Type to search</div></div>
          </div>

          <!-- mvmOS Apps -->
          <div class="as-panel" id="asp-mvmos">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-muted,#888);flex:1">Custom mvmOS apps from the store</span>
              <button class="s-btn" id="as-mvmos-refresh">↺</button>
            </div>
            <div class="as-list" id="as-mvmos-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Output -->
          <div class="as-output-wrap" id="as-output-wrap" style="display:none">
            <div class="as-output-header">
              <span id="as-output-title">Working…</span>
              <button class="s-btn-sm" id="as-output-close">✕</button>
            </div>
            <div class="as-output" id="as-output"></div>
          </div>

        </div>

        <!-- Detail panel -->
        <div class="as-detail" id="as-detail" style="display:none">
          <div class="as-detail-header">
            <button class="s-btn-sm" id="as-detail-close">✕</button>
          </div>
          <div class="as-detail-body" id="as-detail-body"></div>
        </div>
      </div>
    `;

    // state
    let browseState = { section: '', page: 1, title: '' };

    // tabs
    body.querySelectorAll('.as-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        body.querySelectorAll('.as-tab').forEach(t => t.classList.remove('active'));
        body.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        body.querySelector(`#asp-${tab.dataset.tab}`).classList.add('active');
        closeDetail(body);
      });
    });

    // browse — load categories
    loadCategories(body);

    body.querySelector('#as-back').addEventListener('click', () => {
      body.querySelector('#as-browse-pkg').style.display = 'none';
      body.querySelector('#as-cat-grid').style.display = '';
      closeDetail(body);
    });

    body.querySelector('#as-browse-filter').addEventListener('input', e => {
      browseState.page = 1;
      loadBrowsePkgs(body, browseState, e.target.value.trim());
    });

    // installed
    loadInstalled(body);
    body.querySelector('#as-refresh').addEventListener('click', () => loadInstalled(body));
    body.querySelector('#as-installed-filter').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      body.querySelectorAll('#as-installed-list .as-pkg-row').forEach(r => {
        r.style.display = (r.dataset.name.includes(q) || r.dataset.desc.includes(q)) ? '' : 'none';
      });
    });

    // search
    const searchInput = body.querySelector('#as-search-input');
    body.querySelector('#as-search-btn').addEventListener('click', () => runSearch(body, searchInput.value.trim()));
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(body, searchInput.value.trim()); });

    body.querySelector('#as-output-close').addEventListener('click', () => {
      body.querySelector('#as-output-wrap').style.display = 'none';
    });
    body.querySelector('#as-detail-close').addEventListener('click', () => closeDetail(body));

    // mvmOS Apps tab
    loadMvmosApps(body);
    body.querySelector('#as-mvmos-refresh').addEventListener('click', () => loadMvmosApps(body));

    // store browseState on body for access from nested fns
    body._as = { browseState };
  }

  // ── Categories ──
  async function loadCategories(body) {
    const grid = body.querySelector('#as-cat-grid');
    grid.innerHTML = '<div class="as-loading">Loading categories…</div>';
    const res = await fetch('/api/packages/categories');
    const cats = await res.json();
    grid.innerHTML = '';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'as-cat-card';
      card.innerHTML = `
        <span class="as-cat-icon">${cat.icon}</span>
        <span class="as-cat-label">${cat.label}</span>
        <span class="as-cat-count">${cat.count.toLocaleString()}</span>
      `;
      card.addEventListener('click', () => {
        body.querySelector('#as-cat-grid').style.display = 'none';
        body.querySelector('#as-browse-pkg').style.display = 'flex';
        body.querySelector('#as-browse-title').textContent = `${cat.icon} ${cat.label}`;
        body.querySelector('#as-browse-filter').value = '';
        body._as.browseState = { section: cat.section, page: 1 };
        loadBrowsePkgs(body, body._as.browseState, '');
      });
      grid.appendChild(card);
    });
  }

  async function loadBrowsePkgs(body, state, q = '') {
    const list = body.querySelector('#as-browse-list');
    const pager = body.querySelector('#as-pagination');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    pager.innerHTML = '';

    const url = `/api/packages/by-category?section=${encodeURIComponent(state.section)}&page=${state.page}&limit=40&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const data = await res.json();

    renderPkgList(list, data.pkgs, body);

    // pagination
    const totalPages = Math.ceil(data.total / data.limit);
    if (totalPages > 1) {
      pager.innerHTML = `
        <button class="s-btn-sm" id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="as-pg-info">Page ${state.page} / ${totalPages} &nbsp;(${data.total.toLocaleString()} packages)</span>
        <button class="s-btn-sm" id="pg-next" ${state.page >= totalPages ? 'disabled' : ''}>Next →</button>
      `;
      pager.querySelector('#pg-prev')?.addEventListener('click', () => {
        state.page--; loadBrowsePkgs(body, state, q);
      });
      pager.querySelector('#pg-next')?.addEventListener('click', () => {
        state.page++; loadBrowsePkgs(body, state, q);
      });
    } else if (data.total > 0) {
      pager.innerHTML = `<span class="as-pg-info">${data.total.toLocaleString()} packages</span>`;
    }
  }

  // ── Installed ──
  async function loadInstalled(body) {
    const list = body.querySelector('#as-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/packages/installed');
    const pkgs = await res.json();
    renderPkgList(list, pkgs.map(p => ({ ...p, installed: true })), body);
  }

  // ── Search ──
  async function runSearch(body, q) {
    if (!q) return;
    const list = body.querySelector('#as-search-list');
    list.innerHTML = '<div class="as-loading">Searching…</div>';
    const res = await fetch(`/api/packages/search?q=${encodeURIComponent(q)}`);
    const pkgs = await res.json();
    if (!pkgs.length) { list.innerHTML = '<div class="as-loading">No results.</div>'; return; }
    renderPkgList(list, pkgs, body);
  }

  // ── Package list renderer ──
  function renderPkgList(list, pkgs, body) {
    list.innerHTML = '';
    pkgs.forEach(pkg => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.dataset.name = pkg.name.toLowerCase();
      row.dataset.desc = (pkg.description || '').toLowerCase();
      row.dataset.section = (pkg.section || '').toLowerCase();

      row.innerHTML = `
        <div class="as-pkg-info">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${pkg.name}</span>
            ${pkg.section ? `<span class="as-cat-badge as-cat-sm">${pkg.section}</span>` : ''}
            ${pkg.installed ? `<span class="as-installed-badge">Installed</span>` : ''}
          </div>
          <span class="as-pkg-desc">${pkg.description || ''}</span>
        </div>
      `;

      row.addEventListener('click', () => {
        body.querySelectorAll('.as-pkg-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        showDetail(body, pkg, row);
      });

      list.appendChild(row);
    });
  }

  // ── Detail panel ──
  async function showDetail(body, pkg, row) {
    const detail = body.querySelector('#as-detail');
    const detailBody = body.querySelector('#as-detail-body');
    detail.style.display = 'flex';
    detailBody.innerHTML = '<div class="as-loading">Loading…</div>';

    const res = await fetch(`/api/packages/info?name=${encodeURIComponent(pkg.name)}`);
    const info = await res.json();

    const isInstalled = pkg.installed;
    const sizeKb = info.installed_size ? parseInt(info.installed_size).toLocaleString() + ' KB' : null;
    const section = info.section || pkg.section || null;
    const longDesc = info.description_long || '';
    const shortDesc = info.description_short || pkg.description || '';

    detailBody.innerHTML = `
      <div class="as-detail-name">${pkg.name}</div>
      <div class="as-detail-meta">
        ${section ? `<span class="as-cat-badge">${section}</span>` : ''}
        ${info.version ? `<span class="as-detail-ver">v${info.version}</span>` : ''}
        ${sizeKb ? `<span class="as-detail-size">📦 ${sizeKb}</span>` : ''}
      </div>
      <div class="as-detail-short">${shortDesc}</div>
      ${longDesc ? `<div class="as-detail-long">${longDesc}</div>` : ''}
      ${info.homepage ? `<div class="as-detail-link"><a href="${info.homepage}" target="_blank">🌐 Homepage</a></div>` : ''}
      <div class="as-detail-actions" id="as-detail-actions"></div>
    `;

    renderDetailBtn(body, pkg.name, isInstalled, row);
  }

  function renderDetailBtn(body, pkgName, isInstalled, row) {
    const actions = body.querySelector('#as-detail-actions');
    actions.innerHTML = isInstalled
      ? `<button class="s-btn s-btn-full s-btn-danger as-remove-btn" data-pkg="${pkgName}">🗑 Remove</button>`
      : `<button class="s-btn s-btn-full as-install-btn" data-pkg="${pkgName}">⬇ Install</button>`;

    actions.querySelector('.as-install-btn')?.addEventListener('click', async e => {
      await runApt(body, 'install', e.target.dataset.pkg);
      // update row and button
      if (row) {
        row.dataset.installed = '1';
        const top = row.querySelector('.as-pkg-top');
        if (!top.querySelector('.as-installed-badge')) {
          const badge = document.createElement('span');
          badge.className = 'as-installed-badge';
          badge.textContent = 'Installed';
          top.appendChild(badge);
        }
      }
      renderDetailBtn(body, pkgName, true, row);
    });

    actions.querySelector('.as-remove-btn')?.addEventListener('click', async e => {
      if (!confirm(`Remove "${e.target.dataset.pkg}"?`)) return;
      await runApt(body, 'remove', e.target.dataset.pkg);
      if (row) {
        row.querySelector('.as-installed-badge')?.remove();
        delete row.dataset.installed;
      }
      renderDetailBtn(body, pkgName, false, row);
    });
  }

  function closeDetail(body) {
    body.querySelector('#as-detail').style.display = 'none';
    body.querySelectorAll('.as-pkg-row.selected').forEach(r => r.classList.remove('selected'));
  }

  // ── apt stream ──
  async function runApt(body, action, pkgName) {
    const wrap  = body.querySelector('#as-output-wrap');
    const out   = body.querySelector('#as-output');
    const title = body.querySelector('#as-output-title');
    title.textContent = `${action === 'install' ? 'Installing' : 'Removing'} ${pkgName}…`;
    out.textContent = '';
    wrap.style.display = 'flex';

    const res = await fetch(`/api/packages/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pkgName }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let success = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const text = line.slice(6);
        if (text.startsWith('__EXIT_')) {
          const code = text.match(/__EXIT_(\d+)__/)?.[1];
          success = code === '0';
          const el = document.createElement('div');
          el.className = success ? 'as-out-ok' : 'as-out-err';
          el.textContent = success
            ? `✓ ${action === 'install' ? 'Installed' : 'Removed'} successfully`
            : `✗ Failed (exit code ${code})`;
          out.appendChild(el);
        } else {
          const el = document.createElement('div');
          el.textContent = text;
          out.appendChild(el);
        }
        out.scrollTop = out.scrollHeight;
      }
    }
    return success;
  }

  // ── mvmOS Apps ──
  async function loadMvmosApps(body) {
    const list = body.querySelector('#as-mvmos-list');
    list.innerHTML = '<div class="as-loading">Loading from store…</div>';
    let apps;
    try {
      const res = await fetch('/api/plugins/manifest');
      apps = await res.json();
      if (apps.error) throw new Error(apps.error);
    } catch (e) {
      list.innerHTML = `<div class="as-loading">Failed to load store: ${e.message}</div>`;
      return;
    }
    if (!apps.length) { list.innerHTML = '<div class="as-loading">No apps in store.</div>'; return; }

    list.innerHTML = '';
    apps.forEach(app => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info" style="flex:1">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${app.icon} ${app.name}</span>
            <span class="as-cat-badge as-cat-sm">${app.category}</span>
            ${app.installed ? '<span class="as-installed-badge">Installed</span>' : ''}
            ${app.update_available ? '<span class="as-update-badge">Update available</span>' : ''}
          </div>
          <span class="as-pkg-desc">${app.description}</span>
        </div>
        <div class="as-mvmos-actions" style="display:flex;align-items:center;gap:6px;padding-left:10px">
          ${app.update_available ? `<button class="s-btn s-btn-sm as-mvmos-update" data-app='${JSON.stringify(app)}'>↑ Update</button>` : ''}
          ${app.installed
            ? `<button class="s-btn s-btn-sm s-btn-danger as-mvmos-remove" data-id="${app.id}">Remove</button>`
            : `<button class="s-btn s-btn-sm as-mvmos-install" data-app='${JSON.stringify(app)}'>Install</button>`
          }
        </div>
      `;

      async function doInstall(appData, btn, label) {
        btn.disabled = true; btn.textContent = label;
        const res = await fetch('/api/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appData),
        });
        const result = await res.json();
        if (result.ok) {
          mvmOS._loadPlugin(appData.id);
          loadMvmosApps(body);
        } else {
          btn.disabled = false; btn.textContent = btn.dataset.origLabel || 'Install';
          alert('Failed: ' + (result.error || 'unknown error'));
        }
      }

      row.querySelector('.as-mvmos-install')?.addEventListener('click', async e => {
        await doInstall(JSON.parse(e.target.dataset.app), e.target, 'Installing…');
      });

      row.querySelector('.as-mvmos-update')?.addEventListener('click', async e => {
        await doInstall(JSON.parse(e.target.dataset.app), e.target, 'Updating…');
      });

      row.querySelector('.as-mvmos-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Removing…';
        await fetch(`/api/plugins/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeFromStartMenu(btn.dataset.id);
        loadMvmosApps(body);
      });

      list.appendChild(row);
    });
  }

  return { openWindow };
})();
