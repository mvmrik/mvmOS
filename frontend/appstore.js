// ── App Store ────────────────────────────────────────────────────────────────

const AppStore = (() => {

  // opts: string (legacy tab id) or { section: 'widgets', widgetType: 'taskbar'|'desktop'|'' }
  function openWindow(opts) {
    const existing = document.querySelector('.window[data-win-id="appstore"]');
    if (existing) {
      Desktop.focusWindow('appstore');
      if (opts) _applyOpts(existing.querySelector('.window-body') ?? existing, opts);
      return;
    }
    Desktop.createWindow({
      id: 'appstore',
      title: '📦 App Store',
      width: 880,
      height: 580,
      onMount(body) { render(body); if (opts) _applyOpts(body, opts); },
    });
  }

  function _applyOpts(body, opts) {
    if (typeof opts === 'string') {
      body?.querySelector?.(`.as-tab[data-tab="${opts}"]`)?.click();
    } else if (opts?.section === 'widgets') {
      body._as._widgetFilter = opts.widgetType || '';
      body?.querySelector?.('.as-tab[data-section="widgets"]')?.click();
    } else if (opts?.section === 'themes') {
      body?.querySelector?.('.as-tab[data-section="themes"]')?.click();
    }
  }

  // ── Render shell ──────────────────────────────────────────────────────────
  function render(body) {
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="as-wrap">
        <nav class="as-sidebar">
          <div class="as-sidebar-group-label">Linux Packages</div>
          <div class="as-tab" data-tab="browse">🗂️ Browse</div>
          <div class="as-tab" data-tab="installed">✅ Installed</div>
          <div class="as-tab" data-tab="search">🔍 Search</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">mvmOS Apps</div>

          <div id="as-store-tabs"></div>
          <div class="as-tab" data-tab="app-installed">✅ Installed</div>
          <div class="as-tab" data-tab="myapps">👤 My Apps</div>
          <div class="as-tab" data-tab="app-stores">🔗 Stores</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">mvmOS Widgets</div>
          <div id="as-widget-store-tabs"></div>
          <div class="as-tab" data-tab="widget-installed">✅ Installed</div>
          <div class="as-tab" data-tab="my-widgets">👤 My Widgets</div>
          <div class="as-tab" data-tab="widget-stores">🔗 Stores</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">mvmOS Themes</div>
          <div id="as-theme-store-tabs"></div>
          <div class="as-tab" data-tab="theme-installed">✅ Installed</div>
          <div class="as-tab" data-tab="my-themes">👤 My Themes</div>
          <div class="as-tab" data-tab="theme-stores">🔗 Stores</div>
        </nav>
        <div class="as-main">

          <!-- Browse -->
          <div class="as-panel" id="asp-browse">
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

          <!-- Installed (Linux) -->
          <div class="as-panel" id="asp-installed">
            <div class="as-toolbar">
              <input class="as-filter" id="as-installed-filter" placeholder="Filter installed…">
              <button class="s-btn" id="as-refresh">↺</button>
            </div>
            <div class="as-list" id="as-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Search (Linux) -->
          <div class="as-panel" id="asp-search">
            <div class="as-toolbar">
              <input class="as-filter" id="as-search-input" placeholder="Search all packages…">
              <button class="s-btn" id="as-search-btn">Search</button>
            </div>
            <div class="as-list" id="as-search-list"><div class="as-loading">Type to search</div></div>
          </div>

          <!-- My Apps -->
          <!-- App Installed -->
          <div class="as-panel" id="asp-app-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Installed mvmOS apps</span>
              <button class="s-btn" id="as-app-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-app-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- My Apps (custom stores) -->
          <div class="as-panel" id="asp-myapps">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Apps from custom stores</span>
              <button class="s-btn" id="as-myapps-refresh">↺</button>
            </div>
            <div class="as-list" id="as-myapps-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- App Stores management -->
          <div class="as-panel" id="asp-app-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Manage app store sources</span>
              <button class="s-btn" id="as-stores-add-btn">+ Add store</button>
            </div>
            <div id="as-add-store-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);display:none;flex-direction:column;gap:6px">
              <input class="as-filter" id="as-store-name-input" placeholder="Store name">
              <input class="as-filter" id="as-store-url-input" placeholder="manifest.json URL (raw GitHub link)">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-store-submit">Add</button>
                <button class="s-btn-sm" id="as-store-cancel">Cancel</button>
                <span id="as-store-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-stores-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- My Widgets -->
          <div class="as-panel" id="asp-my-widgets">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Widgets from custom stores</span>
              <button class="s-btn" id="as-my-widgets-refresh">↺</button>
            </div>
            <div class="as-list" id="as-my-widgets-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Widget Installed -->
          <div class="as-panel" id="asp-widget-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Installed widgets</span>
              <button class="s-btn" id="as-widget-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-widget-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Widget Stores management -->
          <div class="as-panel" id="asp-widget-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Manage widget store sources</span>
              <button class="s-btn" id="as-wstores-add-btn">+ Add store</button>
            </div>
            <div id="as-add-wstore-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);flex-direction:column;gap:6px">
              <input class="as-filter" id="as-wstore-name-input" placeholder="Store name">
              <input class="as-filter" id="as-wstore-url-input" placeholder="manifest.json URL">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-wstore-submit">Add</button>
                <button class="s-btn-sm" id="as-wstore-cancel">Cancel</button>
                <span id="as-wstore-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-wstores-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Theme Installed -->
          <div class="as-panel" id="asp-theme-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Installed themes</span>
              <button class="s-btn" id="as-theme-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-theme-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- My Themes (custom stores only) -->
          <div class="as-panel" id="asp-my-themes">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Themes from custom stores</span>
              <button class="s-btn" id="as-my-themes-refresh">↺</button>
            </div>
            <div class="as-list" id="as-my-themes-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Theme Stores management -->
          <div class="as-panel" id="asp-theme-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Manage theme store sources</span>
              <button class="s-btn" id="as-tstores-add-btn">+ Add store</button>
            </div>
            <div id="as-add-tstore-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);flex-direction:column;gap:6px">
              <input class="as-filter" id="as-tstore-name-input" placeholder="Store name">
              <input class="as-filter" id="as-tstore-url-input" placeholder="manifest.json URL">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-tstore-submit">Add</button>
                <button class="s-btn-sm" id="as-tstore-cancel">Cancel</button>
                <span id="as-tstore-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-tstores-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Dynamic store panels (added at runtime) -->

          <!-- apt output overlay -->
          <div class="as-output-wrap" id="as-output-wrap" style="display:none">
            <div class="as-output-header">
              <span id="as-output-title">Working…</span>
              <button class="s-btn-sm" id="as-output-close">✕</button>
            </div>
            <div class="as-output" id="as-output"></div>
          </div>

        </div>

        <!-- Detail panel (Linux packages) -->
        <div class="as-detail" id="as-detail" style="display:none">
          <div class="as-detail-header">
            <button class="s-btn-sm" id="as-detail-close">✕</button>
          </div>
          <div class="as-detail-body" id="as-detail-body"></div>
        </div>
      </div>
    `;

    let browseState = { section: '', page: 1 };

    // ── Tab switching ──
    function activateTab(tabEl) {
      body.querySelectorAll('.as-tab').forEach(t => t.classList.remove('active'));
      body.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
      tabEl.classList.add('active');
      const panel = body.querySelector(`#asp-${tabEl.dataset.tab}`);
      if (panel) panel.classList.add('active');
      closeDetail(body);
    }

    let _browsedLoaded = false;
    let _installedLoaded = false;

    body.querySelectorAll('.as-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activateTab(tab);
        if (tab.dataset.tab === 'app-installed') { loadAppInstalled(body); body._as.refreshCurrent = () => loadAppInstalled(body); }
        if (tab.dataset.tab === 'myapps') { loadMyApps(body); body._as.refreshCurrent = () => loadMyApps(body); }
        if (tab.dataset.tab === 'app-stores') loadStores(body);
        if (tab.dataset.tab === 'browse' && !_browsedLoaded) { _browsedLoaded = true; loadCategories(body); }
        if (tab.dataset.tab === 'installed' && !_installedLoaded) { _installedLoaded = true; loadInstalled(body); }
        if (tab.dataset.tab === 'my-widgets') { loadMyWidgets(body); body._as.refreshCurrent = () => loadMyWidgets(body); }
        if (tab.dataset.tab === 'widget-installed') { loadWidgetInstalled(body); body._as.refreshCurrent = () => loadWidgetInstalled(body); }
        if (tab.dataset.tab === 'widget-stores') loadWidgetStores(body);
        if (tab.dataset.tab === 'theme-installed') { loadThemeInstalled(body); body._as.refreshCurrent = () => loadThemeInstalled(body); }
        if (tab.dataset.tab === 'my-themes') { loadMyThemes(body); body._as.refreshCurrent = () => loadMyThemes(body); }
        if (tab.dataset.tab === 'theme-stores') loadThemeStores(body);
      });
    });

    // ── Browse (Linux) ──
    body.querySelector('#as-back').addEventListener('click', () => {
      body.querySelector('#as-browse-pkg').style.display = 'none';
      body.querySelector('#as-cat-grid').style.display = '';
      closeDetail(body);
    });
    body.querySelector('#as-browse-filter').addEventListener('input', e => {
      browseState.page = 1;
      loadBrowsePkgs(body, browseState, e.target.value.trim());
    });

    // ── Installed (Linux) ──
    body.querySelector('#as-refresh').addEventListener('click', () => loadInstalled(body));
    body.querySelector('#as-installed-filter').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      body.querySelectorAll('#as-installed-list .as-pkg-row').forEach(r => {
        r.style.display = (r.dataset.name.includes(q) || r.dataset.desc.includes(q)) ? '' : 'none';
      });
    });

    // ── Search (Linux) ──
    const searchInput = body.querySelector('#as-search-input');
    body.querySelector('#as-search-btn').addEventListener('click', () => runSearch(body, searchInput.value.trim()));
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(body, searchInput.value.trim()); });

    // ── Output close ──
    body.querySelector('#as-output-close').addEventListener('click', () => {
      body.querySelector('#as-output-wrap').style.display = 'none';
    });
    body.querySelector('#as-detail-close').addEventListener('click', () => closeDetail(body));

    // ── App Installed + My Apps refresh ──
    body.querySelector('#as-app-installed-refresh').addEventListener('click', () => loadAppInstalled(body));
    body.querySelector('#as-myapps-refresh').addEventListener('click', () => loadMyApps(body));

    // ── App Stores panel ──
    body.querySelector('#as-stores-add-btn').addEventListener('click', () => {
      const form = body.querySelector('#as-add-store-form');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    body.querySelector('#as-store-cancel').addEventListener('click', () => {
      body.querySelector('#as-add-store-form').style.display = 'none';
    });
    body.querySelector('#as-store-submit').addEventListener('click', () => submitAddStore(body));

    // ── Widget Stores panel ──
    body.querySelector('#as-my-widgets-refresh').addEventListener('click', () => loadMyWidgets(body));
    body.querySelector('#as-widget-installed-refresh').addEventListener('click', () => loadWidgetInstalled(body));
    body.querySelector('#as-wstores-add-btn').addEventListener('click', () => {
      const form = body.querySelector('#as-add-wstore-form');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    body.querySelector('#as-wstore-cancel').addEventListener('click', () => {
      body.querySelector('#as-add-wstore-form').style.display = 'none';
    });
    body.querySelector('#as-wstore-submit').addEventListener('click', () => submitAddWidgetStore(body));

    // ── Theme Stores panel ──
    body.querySelector('#as-theme-installed-refresh').addEventListener('click', () => loadThemeInstalled(body));
    body.querySelector('#as-my-themes-refresh').addEventListener('click', () => loadMyThemes(body));
    body.querySelector('#as-tstores-add-btn').addEventListener('click', () => {
      const form = body.querySelector('#as-add-tstore-form');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    body.querySelector('#as-tstore-cancel').addEventListener('click', () => {
      body.querySelector('#as-add-tstore-form').style.display = 'none';
    });
    body.querySelector('#as-tstore-submit').addEventListener('click', () => submitAddThemeStore(body));

    // ── Load stores → build dynamic tabs ──
    loadStoreTabs(body);
    loadWidgetStoreTabs(body);
    loadThemeStoreTabs(body);

    body._as = { browseState, activateTab, refreshCurrent: null, _widgetFilter: '' };
  }

  // ── Store tabs (sidebar) ──────────────────────────────────────────────────
  async function loadStoreTabs(body) {
    const res = await fetch('/api/plugins/stores');
    const stores = await res.json();
    const tabsEl = body.querySelector('#as-store-tabs');
    tabsEl.innerHTML = '';

    stores.forEach(store => {
      const tab = document.createElement('div');
      tab.className = 'as-tab';
      tab.dataset.tab = `store-${store.id}`;
      tab.textContent = store.official ? `⚡ ${store.name}` : `📦 ${store.name}`;
      tabsEl.appendChild(tab);

      const panelId = `asp-store-${store.id}`;
      if (!body.querySelector(`#${panelId}`)) {
        const panel = document.createElement('div');
        panel.className = 'as-panel';
        panel.id = panelId;
        panel.innerHTML = `<div class="as-list" id="as-store-list-${store.id}"><div class="as-loading">Loading…</div></div>`;
        body.querySelector('.as-main').insertBefore(panel, body.querySelector('#as-output-wrap'));
      }

      tab.addEventListener('click', () => {
        body._as.activateTab(tab);
        loadStoreCategories(body, store);
        body._as.refreshCurrent = () => loadStoreCategories(body, store);
      });
    });

    // auto-activate first store tab
    if (stores.length) {
      const firstTab = tabsEl.querySelector('.as-tab');
      if (firstTab) body._as.activateTab(firstTab);
      loadStoreCategories(body, stores[0]);
      body._as.refreshCurrent = () => loadStoreCategories(body, stores[0]);
    }
  }

  // ── Store categories ──────────────────────────────────────────────────────
  async function loadStoreCategories(body, store) {
    const list = body.querySelector(`#as-store-list-${store.id}`);
    if (!list) return;
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch(`/api/plugins/categories?store_id=${store.id}`);
    const data = await res.json();
    if (data.error) { list.innerHTML = `<div class="as-loading">Error: ${data.error}</div>`; return; }

    // v1 fallback — has _apps, render directly
    if (data.version === 1 && data._apps) {
      renderMvmosApps(list, data._apps.map(a => ({ ...a, official: store.official ?? 0, store_id: store.id })), body);
      return;
    }

    const cats = data.categories || [];
    if (!cats.length) { list.innerHTML = '<div class="as-loading">No categories.</div>'; return; }

    list.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:4px 0';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px 12px;cursor:pointer;text-align:center;transition:background .15s';
      card.innerHTML = `
        <div style="font-size:1.8rem;line-height:1;height:2rem;display:flex;align-items:center;justify-content:center;margin-bottom:8px">${cat.icon || '📦'}</div>
        <div style="font-weight:600;color:var(--text);font-size:.83rem">${cat.name}</div>
        <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px">${cat.count || ''} apps</div>
      `;
      card.addEventListener('mouseenter', () => card.style.background = 'var(--surface)');
      card.addEventListener('mouseleave', () => card.style.background = 'var(--surface2)');
      card.addEventListener('click', () => loadCategoryApps(body, store, cat, list));
      grid.appendChild(card);
    });
    list.appendChild(grid);
  }

  // ── Category apps ─────────────────────────────────────────────────────────
  async function loadCategoryApps(body, store, cat, list) {
    list.innerHTML = '<div class="as-loading">Loading…</div>';

    const params = cat.manifest_url
      ? `category_url=${encodeURIComponent(cat.manifest_url)}`
      : `store_id=${store.id}&category_id=${encodeURIComponent(cat.id)}`;
    const res = await fetch(`/api/plugins/category-apps?${params}`);
    const apps = await res.json();
    if (apps.error) { list.innerHTML = `<div class="as-loading">Error: ${apps.error}</div>`; return; }

    // back button
    const backBar = document.createElement('div');
    backBar.className = 'as-toolbar';
    backBar.innerHTML = `<button class="s-btn s-btn-sm" id="as-cat-back">← ${cat.name}</button>`;
    backBar.querySelector('#as-cat-back').addEventListener('click', () => loadStoreCategories(body, store));
    list.innerHTML = '';
    list.appendChild(backBar);

    const appsEl = document.createElement('div');
    list.appendChild(appsEl);
    renderMvmosApps(appsEl, apps.map(a => ({ ...a, official: store.official ?? 0, store_id: store.id })), body);
    body._as.refreshCurrent = () => loadCategoryApps(body, store, cat, list);
  }

  // ── App Installed (all installed mvmOS apps) ──────────────────────────────
  async function loadAppInstalled(body) {
    const list = body.querySelector('#as-app-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/plugins');
    const plugins = await res.json();
    if (!plugins.length) {
      list.innerHTML = '<div class="as-loading">No mvmOS apps installed.</div>';
      return;
    }
    renderMvmosApps(list, plugins.map(p => ({ ...p, installed: true })), body);
  }

  // ── My Apps (custom stores only) ──────────────────────────────────────────
  async function loadMyApps(body) {
    const list = body.querySelector('#as-myapps-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/plugins');
    const plugins = await res.json();
    const myApps = plugins.filter(p => !p.official);
    if (!myApps.length) {
      list.innerHTML = '<div class="as-loading">No apps from custom stores. Add a store from the Stores tab.</div>';
      return;
    }
    renderMvmosApps(list, myApps.map(p => ({ ...p, installed: true })), body);
  }

  // ── Stores management ─────────────────────────────────────────────────────
  async function loadStores(body) {
    const list = body.querySelector('#as-stores-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/plugins/stores');
    const stores = await res.json();
    list.innerHTML = '';

    stores.forEach(store => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info" style="flex:1">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${store.official ? '⚡' : '📦'} ${store.name}</span>
            ${store.official ? '<span class="as-installed-badge">Official</span>' : ''}
          </div>
          <span class="as-pkg-desc" style="font-family:monospace;font-size:.73rem">${store.manifest_url}</span>
        </div>
        ${!store.official ? `<button class="s-btn s-btn-sm s-btn-danger as-store-remove" data-id="${store.id}" style="flex-shrink:0;margin-left:8px">Remove</button>` : ''}
      `;
      row.querySelector('.as-store-remove')?.addEventListener('click', async e => {
        if (!confirm(`Remove store "${store.name}"?`)) return;
        await fetch(`/api/plugins/stores/${store.id}`, { method: 'DELETE' });
        loadStores(body);
        loadStoreTabs(body);
      });
      list.appendChild(row);
    });
  }

  async function submitAddStore(body) {
    const name = body.querySelector('#as-store-name-input').value.trim();
    const url  = body.querySelector('#as-store-url-input').value.trim();
    const err  = body.querySelector('#as-store-err');
    if (!name || !url) { err.textContent = 'Name and URL are required.'; return; }
    err.textContent = 'Checking…';
    const res = await fetch('/api/plugins/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, manifest_url: url }),
    });
    const data = await res.json();
    if (data.error) { err.textContent = data.error; return; }
    body.querySelector('#as-store-name-input').value = '';
    body.querySelector('#as-store-url-input').value = '';
    body.querySelector('#as-add-store-form').style.display = 'none';
    err.textContent = '';
    loadStores(body);
    loadStoreTabs(body);
  }

  // ── mvmOS app row renderer ────────────────────────────────────────────────
  function renderMvmosApps(list, apps, body) {
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
          <span class="as-pkg-desc">${app.description || ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-left:10px;flex-shrink:0">
          ${app.update_available ? `<button class="s-btn s-btn-sm as-mvmos-update" data-app='${JSON.stringify(app)}'>↑ Update</button>` : ''}
          ${app.installed
            ? `<button class="s-btn s-btn-sm as-mvmos-open" data-id="${app.id}">▶ Open</button>
               <button class="s-btn s-btn-sm s-btn-danger as-mvmos-remove" data-id="${app.id}">Remove</button>`
            : `<button class="s-btn s-btn-sm as-mvmos-install" data-app='${JSON.stringify(app)}'>Install</button>`}
        </div>
      `;

      async function doInstall(appData, btn, label) {
        if (!appData.official) {
          const ok = confirm(
            `⚠️ Third-party app\n\n` +
            `"${appData.name}" is from an unofficial store.\n\n` +
            `mvmOS does not verify third-party apps. Install only from sources you trust. ` +
            `The author is solely responsible for the app's content.\n\n` +
            `Install anyway?`
          );
          if (!ok) return;
        }
        btn.disabled = true; btn.textContent = label;
        const res = await fetch('/api/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appData),
        });
        const result = await res.json();
        if (result.ok) {
          mvmOS._loadPlugin(appData.id);
          body._as?.refreshCurrent?.();
        } else {
          btn.disabled = false; btn.textContent = btn.dataset.orig || 'Install';
          alert('Failed: ' + (result.error || 'unknown'));
        }
      }

      row.querySelector('.as-mvmos-open')?.addEventListener('click', e => {
        const id = e.target.dataset.id;
        fetch(`/api/plugins/${id}/open`, { method: 'POST' }).catch(() => {});
        mvmOS._apps?.[id]?.launch?.() ?? mvmOS._loadPlugin(id).then(() => mvmOS._apps?.[id]?.launch?.());
      });

      row.querySelector('.as-mvmos-install')?.addEventListener('click', async e => {
        e.target.dataset.orig = 'Install';
        await doInstall(JSON.parse(e.target.dataset.app), e.target, 'Installing…');
      });
      row.querySelector('.as-mvmos-update')?.addEventListener('click', async e => {
        e.target.dataset.orig = '↑ Update';
        await doInstall(JSON.parse(e.target.dataset.app), e.target, 'Updating…');
      });
      row.querySelector('.as-mvmos-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Removing…';
        await fetch(`/api/plugins/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeFromStartMenu(btn.dataset.id);
        body._as?.refreshCurrent?.();
      });

      list.appendChild(row);
    });
  }

  // ── Linux packages ────────────────────────────────────────────────────────
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
    const totalPages = Math.ceil(data.total / data.limit);
    if (totalPages > 1) {
      pager.innerHTML = `
        <button class="s-btn-sm" id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="as-pg-info">Page ${state.page} / ${totalPages} &nbsp;(${data.total.toLocaleString()} packages)</span>
        <button class="s-btn-sm" id="pg-next" ${state.page >= totalPages ? 'disabled' : ''}>Next →</button>
      `;
      pager.querySelector('#pg-prev')?.addEventListener('click', () => { state.page--; loadBrowsePkgs(body, state, q); });
      pager.querySelector('#pg-next')?.addEventListener('click', () => { state.page++; loadBrowsePkgs(body, state, q); });
    } else if (data.total > 0) {
      pager.innerHTML = `<span class="as-pg-info">${data.total.toLocaleString()} packages</span>`;
    }
  }

  async function loadInstalled(body) {
    const list = body.querySelector('#as-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/packages/installed');
    const pkgs = await res.json();
    renderPkgList(list, pkgs.map(p => ({ ...p, installed: true })), body);
  }

  async function runSearch(body, q) {
    if (!q) return;
    const list = body.querySelector('#as-search-list');
    list.innerHTML = '<div class="as-loading">Searching…</div>';
    const res = await fetch(`/api/packages/search?q=${encodeURIComponent(q)}`);
    const pkgs = await res.json();
    if (!pkgs.length) { list.innerHTML = '<div class="as-loading">No results.</div>'; return; }
    renderPkgList(list, pkgs, body);
  }

  function renderPkgList(list, pkgs, body) {
    list.innerHTML = '';
    pkgs.forEach(pkg => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.dataset.name = pkg.name.toLowerCase();
      row.dataset.desc = (pkg.description || '').toLowerCase();
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

  // ── Linux package detail ──────────────────────────────────────────────────
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
    detailBody.innerHTML = `
      <div class="as-detail-name">${pkg.name}</div>
      <div class="as-detail-meta">
        ${section ? `<span class="as-cat-badge">${section}</span>` : ''}
        ${info.version ? `<span class="as-detail-ver">v${info.version}</span>` : ''}
        ${sizeKb ? `<span class="as-detail-size">📦 ${sizeKb}</span>` : ''}
      </div>
      <div class="as-detail-short">${info.description_short || pkg.description || ''}</div>
      ${info.description_long ? `<div class="as-detail-long">${info.description_long}</div>` : ''}
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
      if (row) {
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
      if (row) row.querySelector('.as-installed-badge')?.remove();
      renderDetailBtn(body, pkgName, false, row);
    });
  }

  function closeDetail(body) {
    body.querySelector('#as-detail').style.display = 'none';
    body.querySelectorAll('.as-pkg-row.selected').forEach(r => r.classList.remove('selected'));
  }

  // ── apt stream ────────────────────────────────────────────────────────────
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
    let buf = '', success = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
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

  // ── Widget store tabs ─────────────────────────────────────────────────────
  async function loadWidgetStoreTabs(body) {
    const res = await fetch('/api/widgets/stores');
    const stores = await res.json();
    const tabsEl = body.querySelector('#as-widget-store-tabs');
    tabsEl.innerHTML = '';

    stores.forEach(store => {
      const tab = document.createElement('div');
      tab.className = 'as-tab';
      tab.dataset.tab = `wstore-${store.id}`;
      tab.dataset.section = 'widgets';
      tab.textContent = store.official ? `⚡ ${store.name}` : `📦 ${store.name}`;
      tabsEl.appendChild(tab);

      const panelId = `asp-wstore-${store.id}`;
      if (!body.querySelector(`#${panelId}`)) {
        const panel = document.createElement('div');
        panel.className = 'as-panel';
        panel.id = panelId;
        panel.innerHTML = `<div class="as-list" id="as-wstore-list-${store.id}"><div class="as-loading">Loading…</div></div>`;
        body.querySelector('.as-main').insertBefore(panel, body.querySelector('#as-output-wrap'));
      }

      tab.addEventListener('click', () => {
        body._as.activateTab(tab);
        const filter = body._as._widgetFilter || '';
        loadWidgetStoreCategories(body, store, filter);
        body._as.refreshCurrent = () => loadWidgetStoreCategories(body, store, filter);
      });
    });

    if (stores.length) {
      const firstTab = tabsEl.querySelector('.as-tab');
      if (firstTab) body._as.activateTab(firstTab);
      loadWidgetStoreCategories(body, stores[0], body._as._widgetFilter || '');
      body._as.refreshCurrent = () => loadWidgetStoreCategories(body, stores[0], body._as._widgetFilter || '');
    }
  }

  async function loadWidgetStoreCategories(body, store, widgetType) {
    const list = body.querySelector(`#as-wstore-list-${store.id}`);
    if (!list) return;
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const params = `store_id=${store.id}${widgetType ? `&widget_type=${widgetType}` : ''}`;
    const res = await fetch(`/api/widgets/categories?${params}`);
    const data = await res.json();
    if (data.error) { list.innerHTML = `<div class="as-loading">Error: ${data.error}</div>`; return; }

    const cats = data.categories || [];
    if (!cats.length) { list.innerHTML = '<div class="as-loading">No widgets found.</div>'; return; }

    list.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:4px 0';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px 12px;cursor:pointer;text-align:center;transition:background .15s';
      card.innerHTML = `
        <div style="font-size:1.8rem;line-height:1;height:2rem;display:flex;align-items:center;justify-content:center;margin-bottom:8px">${cat.icon || '🔲'}</div>
        <div style="font-weight:600;color:var(--text);font-size:.83rem">${cat.name}</div>
        <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px">${cat.count || ''} widgets</div>
      `;
      card.addEventListener('mouseenter', () => card.style.background = 'var(--surface)');
      card.addEventListener('mouseleave', () => card.style.background = 'var(--surface2)');
      card.addEventListener('click', () => loadWidgetCategoryItems(body, store, cat, list, widgetType));
      grid.appendChild(card);
    });
    list.appendChild(grid);
  }

  async function loadWidgetCategoryItems(body, store, cat, list, widgetType) {
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    let params = cat.manifest_url
      ? `category_url=${encodeURIComponent(cat.manifest_url)}`
      : `store_id=${store.id}&category_id=${encodeURIComponent(cat.id)}`;
    if (widgetType) params += `&widget_type=${widgetType}`;
    const res = await fetch(`/api/widgets/category-widgets?${params}`);
    const widgets = await res.json();
    if (widgets.error) { list.innerHTML = `<div class="as-loading">Error: ${widgets.error}</div>`; return; }

    const backBar = document.createElement('div');
    backBar.className = 'as-toolbar';
    backBar.innerHTML = `<button class="s-btn s-btn-sm">← ${cat.name}</button>`;
    backBar.querySelector('button').addEventListener('click', () => loadWidgetStoreCategories(body, store, widgetType));
    list.innerHTML = '';
    list.appendChild(backBar);

    const el = document.createElement('div');
    list.appendChild(el);
    renderWidgetRows(el, widgets.map(w => ({ ...w, official: store.official ?? 0, store_id: store.id })), body);
    body._as.refreshCurrent = () => loadWidgetCategoryItems(body, store, cat, list, widgetType);
  }

  async function loadMyWidgets(body) {
    const list = body.querySelector('#as-my-widgets-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/widgets');
    const widgets = await res.json();
    const mine = widgets.filter(w => !w.official || w.official === 0);
    if (!mine.length) { list.innerHTML = '<div class="as-loading">No custom widgets installed. Add a store from Widget Stores.</div>'; return; }
    renderWidgetRows(list, mine.map(w => ({ ...w, installed: true })), body);
  }

  async function loadWidgetInstalled(body) {
    const list = body.querySelector('#as-widget-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/widgets');
    const widgets = await res.json();
    if (!widgets.length) { list.innerHTML = '<div class="as-loading">No widgets installed.</div>'; return; }
    renderWidgetRows(list, widgets.map(w => ({ ...w, installed: true })), body);
  }

  async function loadWidgetStores(body) {
    const list = body.querySelector('#as-wstores-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/widgets/stores');
    const stores = await res.json();
    list.innerHTML = '';
    stores.forEach(store => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info" style="flex:1">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${store.official ? '⚡' : '📦'} ${store.name}</span>
            ${store.official ? '<span class="as-installed-badge">Official</span>' : ''}
          </div>
          <span class="as-pkg-desc" style="font-family:monospace;font-size:.73rem">${store.manifest_url}</span>
        </div>
        ${!store.official ? `<button class="s-btn s-btn-sm s-btn-danger" data-id="${store.id}">Remove</button>` : ''}
      `;
      row.querySelector('[data-id]')?.addEventListener('click', async e => {
        if (!confirm(`Remove store "${store.name}"?`)) return;
        await fetch(`/api/widgets/stores/${store.id}`, { method: 'DELETE' });
        loadWidgetStores(body);
        loadWidgetStoreTabs(body);
      });
      list.appendChild(row);
    });
  }

  async function submitAddWidgetStore(body) {
    const name = body.querySelector('#as-wstore-name-input').value.trim();
    const url  = body.querySelector('#as-wstore-url-input').value.trim();
    const err  = body.querySelector('#as-wstore-err');
    if (!name || !url) { err.textContent = 'Name and URL required.'; return; }
    err.textContent = 'Checking…';
    const res = await fetch('/api/widgets/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, manifest_url: url }),
    });
    const data = await res.json();
    if (data.error) { err.textContent = data.error; return; }
    body.querySelector('#as-wstore-name-input').value = '';
    body.querySelector('#as-wstore-url-input').value = '';
    body.querySelector('#as-add-wstore-form').style.display = 'none';
    err.textContent = '';
    loadWidgetStores(body);
    loadWidgetStoreTabs(body);
  }

  function renderWidgetRows(list, widgets, body) {
    list.innerHTML = '';
    widgets.forEach(w => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info" style="flex:1">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${w.icon} ${w.name}</span>
            <span class="as-cat-badge as-cat-sm">${w.category}</span>
            ${w.widget_type ? `<span class="as-cat-badge as-cat-sm" style="background:#89b4fa20;color:#89b4fa">${w.widget_type}</span>` : ''}
            ${w.installed ? '<span class="as-installed-badge">Installed</span>' : ''}
            ${w.update_available ? '<span class="as-update-badge">Update</span>' : ''}
          </div>
          <span class="as-pkg-desc">${w.description || ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-left:10px;flex-shrink:0">
          ${w.update_available ? `<button class="s-btn s-btn-sm ws-update" data-widget='${JSON.stringify(w)}'>↑ Update</button>` : ''}
          ${w.installed
            ? `<button class="s-btn s-btn-sm s-btn-danger ws-remove" data-id="${w.id}">Remove</button>`
            : `<button class="s-btn s-btn-sm ws-install" data-widget='${JSON.stringify(w)}'>Install</button>`}
        </div>
      `;

      async function doWidgetInstall(data, btn, label) {
        if (!data.official) {
          if (!confirm(`⚠️ Third-party widget\n\n"${data.name}" is from an unofficial store. Install anyway?`)) return;
        }
        btn.disabled = true; btn.textContent = label;
        const res = await fetch('/api/widgets/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.ok) {
          await mvmOS._loadWidget(data.id);
          body._as.refreshCurrent?.();
        } else {
          btn.disabled = false; btn.textContent = label === 'Installing…' ? 'Install' : '↑ Update';
          alert('Failed: ' + (result.error || 'unknown'));
        }
      }

      row.querySelector('.ws-install')?.addEventListener('click', e => {
        doWidgetInstall(JSON.parse(e.target.dataset.widget), e.target, 'Installing…');
      });
      row.querySelector('.ws-update')?.addEventListener('click', e => {
        doWidgetInstall(JSON.parse(e.target.dataset.widget), e.target, 'Updating…');
      });
      row.querySelector('.ws-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Removing…';
        await fetch(`/api/widgets/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeWidget(btn.dataset.id);
        body._as.refreshCurrent?.();
      });

      list.appendChild(row);
    });
  }

  // ── Theme Store tabs (sidebar) ───────────────────────────────────────────────
  async function loadThemeStoreTabs(body) {
    const container = body.querySelector('#as-theme-store-tabs');
    if (!container) return;
    container.innerHTML = '';
    const res = await fetch('/api/themes/stores');
    const stores = await res.json();
    stores.forEach(store => {
      const tab = document.createElement('div');
      tab.className = 'as-tab';
      tab.dataset.tab = `tstore-${store.id}`;
      tab.dataset.section = 'themes';
      tab.dataset.storeManifest = store.manifest_url;
      tab.textContent = `🏪 ${store.name}`;
      tab.addEventListener('click', () => {
        body._as?.activateTab(tab);
        loadThemeStoreCategories(body, store, tab);
      });
      container.appendChild(tab);
    });
  }

  async function loadThemeStoreCategories(body, store, tab) {
    const manifestUrl = typeof store === 'string' ? store : store.manifest_url;
    const storeId = typeof store === 'object' ? store.id : null;
    const main = body.querySelector('.as-main');
    let panel = tab?._panel;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'as-panel';
      panel.innerHTML = `<div class="as-list as-cat-grid" id="as-tcat-grid-${Date.now()}"><div class="as-loading">Loading…</div></div>`;
      main.appendChild(panel);
      if (tab) tab._panel = panel;
    }
    body.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
    panel.classList.add('active');

    const gridEl = panel.querySelector('[id^="as-tcat-grid"]');
    gridEl.innerHTML = '<div class="as-loading">Loading…</div>';

    const res = await fetch('/api/themes/categories');
    const cats = await res.json();

    if (!cats.length) { gridEl.innerHTML = '<div class="as-loading">No categories found.</div>'; return; }

    gridEl.innerHTML = cats.map(c => `
      <div class="as-cat-card" data-manifest="${c.manifest_url}">
        <div class="as-cat-icon" style="height:2rem;display:flex;align-items:center;justify-content:center">${c.icon}</div>
        <div class="as-cat-label">${c.name}</div>
        <div class="as-cat-count">${c.count || ''}</div>
      </div>
    `).join('');

    gridEl.querySelectorAll('.as-cat-card').forEach(card => {
      card.addEventListener('click', () => loadThemeCategoryItems(body, card.dataset.manifest, panel, storeId));
    });
  }

  async function loadThemeCategoryItems(body, manifestUrl, panel, storeId) {
    const gridEl = panel.querySelector('[id^="as-tcat-grid"]');
    gridEl.innerHTML = '<div class="as-loading">Loading…</div>';

    const [catRes, installedRes] = await Promise.all([
      fetch(`/api/themes/category-themes?manifest_url=${encodeURIComponent(manifestUrl)}`),
      fetch('/api/themes'),
    ]);
    const items = await catRes.json();
    const installed = await installedRes.json();
    const installedMap = Object.fromEntries(installed.map(t => [t.id, t]));

    gridEl.innerHTML = '';
    const backBtn = document.createElement('div');
    backBtn.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);';
    backBtn.innerHTML = `<button class="s-btn-sm">← Back</button>`;
    backBtn.querySelector('button').addEventListener('click', async () => {
      const catRes2 = await fetch('/api/themes/categories');
      const cats2 = await catRes2.json();
      gridEl.innerHTML = cats2.map(c => `
        <div class="as-cat-card" data-manifest="${c.manifest_url}">
          <div class="as-cat-icon" style="height:2rem;display:flex;align-items:center;justify-content:center">${c.icon}</div>
          <div class="as-cat-label">${c.name}</div>
          <div class="as-cat-count">${c.count || ''}</div>
        </div>
      `).join('');
      gridEl.querySelectorAll('.as-cat-card').forEach(card => {
        card.addEventListener('click', () => loadThemeCategoryItems(body, card.dataset.manifest, panel, storeId));
      });
    });
    gridEl.appendChild(backBtn);

    if (!items.length) { gridEl.innerHTML += '<div class="as-loading">No themes found.</div>'; return; }

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';
    items.forEach(t => {
      const inst = installedMap[t.id];
      const isActive = inst?.is_active;
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div style="font-size:1.4rem;width:28px;text-align:center;flex-shrink:0">${t.icon}</div>
        <div class="as-pkg-info">
          <div class="as-pkg-top"><span class="as-pkg-name">${t.name}</span></div>
          <div class="as-pkg-desc">${t.description}</div>
          <div class="as-pkg-ver">${t.version} · ${t.layout}</div>
        </div>
        <div class="as-pkg-actions">
          ${isActive ? '<span class="as-installed-badge">✓ Active</span>' :
            inst ? `<button class="s-btn s-btn-sm ts-activate" data-id="${t.id}">Activate</button>
                    <button class="s-btn-sm s-btn-danger ts-remove" data-id="${t.id}">✕</button>` :
            `<button class="s-btn ts-install" data-theme='${JSON.stringify({...t, store_id: storeId ?? null})}'>Install</button>`
          }
        </div>
      `;

      row.querySelector('.ts-install')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Installing…';
        const data = JSON.parse(btn.dataset.theme);
        const res = await fetch('/api/themes/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if ((await res.json()).ok) {
          body._as.refreshCurrent?.();
          loadThemeCategoryItems(body, manifestUrl, panel, storeId);
        } else { btn.disabled = false; btn.textContent = 'Install'; }
      });

      row.querySelector('.ts-activate')?.addEventListener('click', async e => {
        await mvmOS._applyTheme(e.target.dataset.id);
        loadThemeCategoryItems(body, manifestUrl, panel, storeId);
      });

      row.querySelector('.ts-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true;
        await fetch(`/api/themes/${btn.dataset.id}`, { method: 'DELETE' });
        body._as.refreshCurrent?.();
        loadThemeCategoryItems(body, manifestUrl, panel, storeId);
      });

      list.appendChild(row);
    });
    gridEl.appendChild(list);
  }

  function _renderThemeRows(list, themes, onRefresh) {
    list.innerHTML = '';
    themes.forEach(t => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div style="font-size:1.4rem;width:28px;text-align:center;flex-shrink:0">${t.icon}</div>
        <div class="as-pkg-info">
          <div class="as-pkg-top"><span class="as-pkg-name">${t.name}</span></div>
          <div class="as-pkg-desc">${t.description}</div>
          <div class="as-pkg-ver">${t.version} · ${t.category}</div>
        </div>
        <div class="as-pkg-actions">
          ${t.is_active
            ? '<span class="as-installed-badge">✓ Active</span>'
            : `<button class="s-btn s-btn-sm ts-activate" data-id="${t.id}">Activate</button>
               ${t.id !== 'default' ? `<button class="s-btn-sm s-btn-danger ts-remove" data-id="${t.id}">✕</button>` : ''}`
          }
        </div>
      `;
      row.querySelector('.ts-activate')?.addEventListener('click', async e => {
        await mvmOS._applyTheme(e.target.dataset.id);
        onRefresh();
      });
      row.querySelector('.ts-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true;
        await fetch(`/api/themes/${btn.dataset.id}`, { method: 'DELETE' });
        onRefresh();
      });
      list.appendChild(row);
    });
  }

  async function loadThemeInstalled(body) {
    const list = body.querySelector('#as-theme-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/themes');
    const themes = await res.json();
    if (!themes.length) { list.innerHTML = '<div class="as-loading">No themes installed.</div>'; return; }
    _renderThemeRows(list, themes, () => loadThemeInstalled(body));
  }

  async function loadMyThemes(body) {
    const list = body.querySelector('#as-my-themes-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const [themesRes, storesRes] = await Promise.all([fetch('/api/themes'), fetch('/api/themes/stores')]);
    const themes = await themesRes.json();
    const stores = await storesRes.json();
    const officialIds = new Set(stores.filter(s => s.official).map(s => s.id));
    const custom = themes.filter(t => t.store_id && !officialIds.has(t.store_id));
    if (!custom.length) { list.innerHTML = '<div class="as-loading">No themes from custom stores.</div>'; return; }
    _renderThemeRows(list, custom, () => loadMyThemes(body));
  }

  async function loadThemeStores(body) {
    const list = body.querySelector('#as-tstores-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/themes/stores');
    const stores = await res.json();
    list.innerHTML = '';
    stores.forEach(s => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info">
          <div class="as-pkg-name">${s.name}</div>
          <div class="as-pkg-desc" style="font-family:monospace;font-size:.72rem">${s.manifest_url}</div>
        </div>
        <div class="as-pkg-actions">
          ${s.official ? '<span class="as-installed-badge">Official</span>' :
            `<button class="s-btn-sm s-btn-danger ts-del-store" data-id="${s.id}">✕ Remove</button>`}
        </div>
      `;
      row.querySelector('.ts-del-store')?.addEventListener('click', async e => {
        await fetch(`/api/themes/stores/${e.target.dataset.id}`, { method: 'DELETE' });
        loadThemeStores(body);
        loadThemeStoreTabs(body);
      });
      list.appendChild(row);
    });
  }

  async function submitAddThemeStore(body) {
    const name = body.querySelector('#as-tstore-name-input').value.trim();
    const url  = body.querySelector('#as-tstore-url-input').value.trim();
    const err  = body.querySelector('#as-tstore-err');
    if (!name || !url) { err.textContent = 'Name and URL required'; return; }
    const res = await fetch('/api/themes/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, manifest_url: url }),
    });
    if (res.ok) {
      body.querySelector('#as-add-tstore-form').style.display = 'none';
      body.querySelector('#as-tstore-name-input').value = '';
      body.querySelector('#as-tstore-url-input').value = '';
      err.textContent = '';
      loadThemeStores(body);
      loadThemeStoreTabs(body);
    } else {
      const d = await res.json();
      err.textContent = d.detail || 'Error';
    }
  }

  return { openWindow };
})();

// ── WidgetStore alias (for desktop/taskbar context menus) ─────────────────────
const WidgetStore = {
  openWindow(widgetType) {
    AppStore.openWindow({ section: 'widgets', widgetType: widgetType || '' });
  }
};
