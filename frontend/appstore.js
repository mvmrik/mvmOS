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
      title: `📦 ${t('app_appstore')}`,
      width: 880,
      height: 580,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => { render(body); if (opts) _applyOpts(body, opts); Desktop.initMobileSidebar(body); }); },
    });
  }

  function _applyOpts(body, opts) {
    if (typeof opts === 'string') {
      body?.querySelector?.(`.as-tab[data-tab="${opts}"]`)?.click();
    } else if (opts?.section === 'widgets') {
      const wt = opts.widgetType || '';
      body._as._pendingWidgetFilter = wt;
      const wsTab = body.querySelector('#as-widget-store-tabs .as-tab');
      if (wsTab) {
        wsTab.click();
      } else {
        // tabs not yet loaded — poll briefly then click
        let attempts = 0;
        const t = setInterval(() => {
          const tab = body.querySelector('#as-widget-store-tabs .as-tab');
          if (tab || ++attempts > 20) {
            clearInterval(t);
            if (tab) tab.click();
          }
        }, 50);
      }
    } else if (opts?.section === 'my-widgets') {
      const tab = body.querySelector('.as-tab[data-tab="my-widgets"]');
      if (tab) {
        if (opts.widgetId) {
          body._as._pendingWidgetSettings = opts.widgetId;
          body._as._suppressWidgetStoreAutoActivate = true;
        }
        setTimeout(() => tab.click(), 50);
      }
    } else if (opts?.section === 'my-apps') {
      if (opts.appId) {
        body._as._pendingAppSettings = opts.appId;
        body._as._suppressWidgetStoreAutoActivate = true;
      }
      const tab = body.querySelector('.as-tab[data-tab="app-installed"]');
      if (tab) setTimeout(() => tab.click(), 50);
    } else if (opts?.section === 'themes') {
      const thTab = body.querySelector('#as-theme-store-tabs .as-tab');
      if (thTab) thTab.click();
    }
  }

  // ── Render shell ──────────────────────────────────────────────────────────
  function render(body) {
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="as-wrap">
        <nav class="as-sidebar">
          <div class="as-sidebar-group-label">${t('as_linux_packages')}</div>
          <div class="as-tab" data-tab="browse">${t('as_browse')}</div>
          <div class="as-tab" data-tab="installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="search">${t('as_search')}</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">${t('as_mvmos_apps')}</div>

          <div id="as-store-tabs"></div>
          <div class="as-tab" data-tab="app-installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="myapps">${t('as_my_apps')}</div>
          <div class="as-tab" data-tab="app-stores">🔗 ${t('as_stores')}</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">${t('as_mvmos_widgets')}</div>
          <div id="as-widget-store-tabs"></div>
          <div class="as-tab" data-tab="widget-installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="my-widgets">${t('as_my_widgets')}</div>
          <div class="as-tab" data-tab="widget-stores">🔗 ${t('as_stores')}</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">${t('as_mvmos_themes')}</div>
          <div id="as-theme-store-tabs"></div>
          <div class="as-tab" data-tab="theme-installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="my-themes">${t('as_my_themes')}</div>
          <div class="as-tab" data-tab="theme-stores">🔗 ${t('as_stores')}</div>
        </nav>
        <div class="as-main">

          <!-- Browse -->
          <div class="as-panel" id="asp-browse">
            <div class="as-list as-cat-grid" id="as-cat-grid"><div class="as-loading"\>${t('appstore_loading_categories')}</div></div>
            <div class="as-browse-pkg" id="as-browse-pkg" style="display:none">
              <div class="as-toolbar">
                <button class="s-btn-sm" id="as-back">${t('as_back')}</button>
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
              <input class="as-filter" id="as-installed-filter" placeholder="${t('as_filter_installed_ph')}">
              <button class="s-btn" id="as-refresh">↺</button>
            </div>
            <div class="as-list" id="as-installed-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Search (Linux) -->
          <div class="as-panel" id="asp-search">
            <div class="as-toolbar">
              <input class="as-filter" id="as-search-input" placeholder="${t('as_search_all_ph')}">
              <button class="s-btn" id="as-search-btn">${t('as_search_btn')}</button>
            </div>
            <div class="as-list" id="as-search-list"><div class="as-loading">${t('as_type_to_search')}</div></div>
          </div>

          <!-- My Apps -->
          <!-- App Installed -->
          <div class="as-panel" id="asp-app-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_installed_apps_label')}</span>
              <button class="s-btn" id="as-app-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-app-installed-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- My Apps (custom stores) -->
          <div class="as-panel" id="asp-myapps">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_custom_apps_label')}</span>
              <button class="s-btn" id="as-myapps-refresh">↺</button>
            </div>
            <div class="as-list" id="as-myapps-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- App Stores management -->
          <div class="as-panel" id="asp-app-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_manage_app_stores')}</span>
              <button class="s-btn" id="as-stores-add-btn">${t('as_add_store')}</button>
            </div>
            <div id="as-add-store-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);display:none;flex-direction:column;gap:6px">
              <input class="as-filter" id="as-store-name-input" placeholder="${t('as_store_name_ph')}">
              <input class="as-filter" id="as-store-url-input" placeholder="${t('as_store_url_ph')}">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-store-submit">${t('as_add_btn')}</button>
                <button class="s-btn-sm" id="as-store-cancel">${t('as_cancel_btn')}</button>
                <span id="as-store-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-stores-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- My Widgets -->
          <div class="as-panel" id="asp-my-widgets">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_custom_widgets_label')}</span>
              <button class="s-btn" id="as-my-widgets-refresh">↺</button>
            </div>
            <div class="as-list" id="as-my-widgets-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Widget Installed -->
          <div class="as-panel" id="asp-widget-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_installed_widgets_label')}</span>
              <button class="s-btn" id="as-widget-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-widget-installed-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Widget Stores management -->
          <div class="as-panel" id="asp-widget-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_manage_widget_stores')}</span>
              <button class="s-btn" id="as-wstores-add-btn">${t('as_add_store')}</button>
            </div>
            <div id="as-add-wstore-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);flex-direction:column;gap:6px">
              <input class="as-filter" id="as-wstore-name-input" placeholder="${t('as_store_name_ph')}">
              <input class="as-filter" id="as-wstore-url-input" placeholder="${t('as_store_url_ph')}">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-wstore-submit">${t('as_add_btn')}</button>
                <button class="s-btn-sm" id="as-wstore-cancel">${t('as_cancel_btn')}</button>
                <span id="as-wstore-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-wstores-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Theme Installed -->
          <div class="as-panel" id="asp-theme-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_installed_themes_label')}</span>
              <button class="s-btn" id="as-theme-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-theme-installed-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- My Themes (custom stores only) -->
          <div class="as-panel" id="asp-my-themes">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_custom_themes_label')}</span>
              <button class="s-btn" id="as-my-themes-refresh">↺</button>
            </div>
            <div class="as-list" id="as-my-themes-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Theme Stores management -->
          <div class="as-panel" id="asp-theme-stores">
            <div class="as-toolbar" style="flex-wrap:wrap;gap:6px">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_manage_theme_stores')}</span>
              <button class="s-btn" id="as-tstores-add-btn">${t('as_add_store')}</button>
            </div>
            <div id="as-add-tstore-form" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border);flex-direction:column;gap:6px">
              <input class="as-filter" id="as-tstore-name-input" placeholder="${t('as_store_name_ph')}">
              <input class="as-filter" id="as-tstore-url-input" placeholder="${t('as_store_url_ph')}">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="as-tstore-submit">${t('as_add_btn')}</button>
                <button class="s-btn-sm" id="as-tstore-cancel">${t('as_cancel_btn')}</button>
                <span id="as-tstore-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="as-tstores-list"><div class="as-loading"\>${t('loading')}</div></div>
          </div>

          <!-- Dynamic store panels (added at runtime) -->

          <!-- apt output overlay -->
          <div class="as-output-wrap" id="as-output-wrap" style="display:none">
            <div class="as-output-header">
              <span id="as-output-title"\>${t('appstore_working')}</span>
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

    body._as = { browseState, activateTab, refreshCurrent: null };

    // ── Load stores → build dynamic tabs ──
    loadStoreTabs(body);
    loadWidgetStoreTabs(body);
    loadThemeStoreTabs(body);
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
        panel.innerHTML = `<div class="as-list" id="as-store-list-${store.id}"><div class="as-loading"\>${t('loading')}</div></div>`;
        body.querySelector('.as-main').insertBefore(panel, body.querySelector('#as-output-wrap'));
      }

      tab.addEventListener('click', () => {
        body._as.activateTab(tab);
        loadStoreCategories(body, store);
        body._as.refreshCurrent = () => loadStoreCategories(body, store);
      });
    });

    // auto-activate first store tab unless my-widgets settings pending
    if (stores.length && !body._as._suppressWidgetStoreAutoActivate) {
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch(`/api/plugins/categories?store_id=${store.id}`);
    const data = await res.json();
    if (data.error) { list.innerHTML = `<div class="as-loading">Error: ${data.error}</div>`; return; }

    // v1 fallback — has _apps, render directly
    if (data.version === 1 && data._apps) {
      renderMvmosApps(list, data._apps.map(a => ({ ...a, official: store.official ?? 0, store_id: store.id })), body);
      return;
    }

    const cats = data.categories || [];
    if (!cats.length) { list.innerHTML = `<div class="as-loading">${t('wstore_no_categories')}</div>`; return; }

    list.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:4px 0';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px 12px;cursor:pointer;text-align:center;transition:background .15s';
      card.innerHTML = `
        <div style="font-size:1.8rem;line-height:1;height:2rem;display:flex;align-items:center;justify-content:center;margin-bottom:8px">${cat.icon || '📦'}</div>
        <div style="font-weight:600;color:var(--text);font-size:.83rem">${cat.name}</div>
        <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px">${cat.count ? cat.count + ' apps' : ''}</div>
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;

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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/plugins');
    const plugins = await res.json();
    if (!plugins.length) {
      list.innerHTML = `<div class="as-loading">${t('appstore_no_installed')}</div>`;
      return;
    }
    const pendingAppId = body._as?._pendingAppSettings;
    if (pendingAppId) delete body._as._pendingAppSettings;
    renderMvmosApps(list, plugins.map(p => ({ ...p, installed: true })), body);
    if (pendingAppId) {
      const app = plugins.find(p => p.id === pendingAppId);
      if (app) _openAppSettings(body, pendingAppId, app);
    }
  }

  // ── My Apps (custom stores only) ──────────────────────────────────────────
  async function loadMyApps(body) {
    const list = body.querySelector('#as-myapps-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/plugins');
    const plugins = await res.json();
    const myApps = plugins.filter(p => !p.official);
    if (!myApps.length) {
      list.innerHTML = `<div class="as-loading">${t('appstore_no_custom')}</div>`;
      return;
    }
    const pendingAppId = body._as?._pendingAppSettings;
    if (pendingAppId) delete body._as._pendingAppSettings;
    renderMvmosApps(list, myApps.map(p => ({ ...p, installed: true })), body);
    if (pendingAppId) {
      const app = myApps.find(p => p.id === pendingAppId);
      if (app) _openAppSettings(body, pendingAppId);
    }
  }

  // ── Stores management ─────────────────────────────────────────────────────
  async function loadStores(body) {
    const list = body.querySelector('#as-stores-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    if (!name || !url) { err.textContent = t('um_name_url_required'); return; }
    err.textContent = t('appstore_checking');
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
            ${app.installed ? `<span class="as-installed-badge">${t('appstore_installed_badge')}</span>` : ''}
            ${app.update_available ? '<span class="as-update-badge">Update available</span>' : ''}
          </div>
          <span class="as-pkg-desc">${app.description || ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-left:10px;flex-shrink:0">
          ${app.update_available ? `<button class="s-btn s-btn-sm as-mvmos-update" data-app='${JSON.stringify(app)}'>${t('um_update_btn')}</button>` : ''}
          ${app.installed
            ? `<button class="s-btn s-btn-sm as-mvmos-open" data-id="${app.id}">▶ ${t('appstore_open')}</button>
               ${app.settings?.length ? `<button class="s-btn s-btn-sm as-mvmos-settings" data-id="${app.id}">⚙ ${t('wstore_settings')}</button>` : ''}
               <button class="s-btn s-btn-sm s-btn-danger as-mvmos-remove" data-id="${app.id}">${t('appstore_remove')}</button>`
            : `<button class="s-btn s-btn-sm as-mvmos-install" data-app='${JSON.stringify(app)}'>${t('appstore_install')}</button>`}
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
        if (result.needs_backend_confirm) {
          const confirmed = await _backendConfirmDialog(body, appData.name);
          if (!confirmed) { btn.disabled = false; btn.textContent = btn.dataset.orig || t('appstore_install'); return; }
          const res2 = await fetch('/api/plugins/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...appData, install_backend: true }),
          });
          const result2 = await res2.json();
          if (result2.ok) {
            mvmOS._loadPlugin(appData.id);
            body._as?.refreshCurrent?.();
          } else {
            btn.disabled = false; btn.textContent = btn.dataset.orig || t('appstore_install');
            alert('Failed: ' + (result2.error || 'unknown'));
          }
        } else if (result.ok) {
          mvmOS._loadPlugin(appData.id);
          body._as?.refreshCurrent?.();
        } else {
          btn.disabled = false; btn.textContent = btn.dataset.orig || t('appstore_install');
          alert('Failed: ' + (result.error || 'unknown'));
        }
      }

      row.querySelector('.as-mvmos-open')?.addEventListener('click', e => {
        const id = e.target.dataset.id;
        fetch(`/api/plugins/${id}/open`, { method: 'POST' }).catch(() => {});
        mvmOS._apps?.[id]?.launch?.() ?? mvmOS._loadPlugin(id).then(() => mvmOS._apps?.[id]?.launch?.());
      });

      row.querySelector('.as-mvmos-install')?.addEventListener('click', async e => {
        e.target.dataset.orig = t('appstore_install');
        await doInstall(JSON.parse(e.target.dataset.app), e.target, t('um_installing'));
      });
      row.querySelector('.as-mvmos-update')?.addEventListener('click', async e => {
        e.target.dataset.orig = t('um_update_btn');
        await doInstall(JSON.parse(e.target.dataset.app), e.target, 'Updating…');
      });
      row.querySelector('.as-mvmos-settings')?.addEventListener('click', e => {
        _openAppSettings(body, e.target.dataset.id, app);
      });
      row.querySelector('.as-mvmos-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = t('um_removing');
        await fetch(`/api/plugins/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeFromStartMenu(btn.dataset.id);
        body._as?.refreshCurrent?.();
      });

      list.appendChild(row);
    });
  }

  function _backendConfirmDialog(body, appName) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
      ov.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:400px;width:90%;box-shadow:var(--shadow)">
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">⚠️ ${t('appstore_backend_title')}</div>
          <div style="font-size:.85rem;color:var(--text-dim);margin-bottom:6px">"${appName}" ${t('appstore_backend_msg')}</div>
          <div style="font-size:.8rem;color:#f38ba8;margin-bottom:16px">${t('appstore_backend_warn')}</div>
          <label style="font-size:.82rem;color:var(--text-dim);display:block;margin-bottom:4px">${t('appstore_backend_password')}</label>
          <input type="password" id="as-backend-pw" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:.85rem;margin-bottom:6px" placeholder="${t('appstore_backend_password_ph')}">
          <div id="as-backend-err" style="font-size:.78rem;color:#f38ba8;min-height:16px;margin-bottom:12px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="as-backend-cancel" class="s-btn s-btn-sm">${t('cancel')}</button>
            <button id="as-backend-ok" class="s-btn s-btn-sm s-btn-primary">${t('appstore_install')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(ov);
      const pwInput = ov.querySelector('#as-backend-pw');
      const errEl = ov.querySelector('#as-backend-err');
      pwInput.focus();

      ov.querySelector('#as-backend-cancel').addEventListener('click', () => { ov.remove(); resolve(false); });
      const doConfirm = async () => {
        const pw = pwInput.value;
        if (!pw) { errEl.textContent = t('appstore_backend_password_required'); return; }
        const okBtn = ov.querySelector('#as-backend-ok');
        okBtn.disabled = true; okBtn.textContent = '…';
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) { ov.remove(); resolve(true); }
        else { errEl.textContent = t('appstore_backend_wrong_password'); okBtn.disabled = false; okBtn.textContent = t('appstore_install'); pwInput.value = ''; pwInput.focus(); }
      };
      ov.querySelector('#as-backend-ok').addEventListener('click', doConfirm);
      pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    });
  }

  async function _openAppSettings(body, appId, appData) {
    const def = mvmOS._apps?.[appId];
    const settings = appData?.settings || def?.settings || [];
    const main = body.querySelector('#as-app-installed-list') || body.querySelector('#as-installed-list');
    if (!main) return;

    const db = mvmOS.db(appId);
    await db.run('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)');
    const rows = await db.query('SELECT key, value FROM cfg');
    const saved = {};
    rows.forEach(r => { try { saved[r.key] = JSON.parse(r.value); } catch(_) { saved[r.key] = r.value; } });

    const prev = main.innerHTML;
    const header = body.querySelector('#as-app-installed-list')?.previousElementSibling || null;

    main.innerHTML = `
      <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)">
        <button class="s-btn s-btn-sm" id="as-app-settings-back">← ${t('as_back')}</button>
        <span style="font-weight:600;font-size:.9rem">${def.icon || ''} ${def.name} — ${t('wstore_settings_title')}</span>
      </div>
      <div id="as-app-settings-content" style="padding:14px;display:flex;flex-direction:column;gap:10px"></div>
      <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button class="s-btn s-btn-sm" id="as-app-settings-cancel">${t('as_cancel_btn')}</button>
        <button class="s-btn s-btn-sm" id="as-app-settings-save">${t('wstore_settings_save')}</button>
      </div>
    `;

    const content = main.querySelector('#as-app-settings-content');
    const inputs = {};
    settings.forEach(s => {
      const val = saved[s.key] ?? s.default ?? '';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:4px';
      let input;
      if (s.type === 'select') {
        input = `<select class="s-input" data-key="${s.key}">${s.options.map(o => `<option value="${o}"${val===o?' selected':''}>${o}</option>`).join('')}</select>`;
      } else if (s.type === 'checkbox') {
        input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-key="${s.key}" ${val?'checked':''}> ${s.label}</label>`;
      } else {
        input = `<input class="s-input" type="${s.type === 'password' ? 'password' : s.type === 'number' ? 'number' : 'text'}" data-key="${s.key}" value="${val}" ${s.min!=null?`min="${s.min}"`:''}  ${s.max!=null?`max="${s.max}"`:''}  placeholder="${s.default ?? ''}">`;
      }
      row.innerHTML = `<label style="font-size:.8rem;color:var(--text-dim)">${s.label}</label>${input}`;
      content.appendChild(row);
    });

    // extra section rendered by the app itself
    const def2 = mvmOS._apps?.[appId];
    if (typeof def2?.renderSettingsExtra === 'function') {
      const extraWrap = document.createElement('div');
      content.appendChild(extraWrap);
      def2.renderSettingsExtra(extraWrap, saved);
    }

    main.querySelector('#as-app-settings-back').addEventListener('click', () => { main.innerHTML = prev; });
    main.querySelector('#as-app-settings-cancel').addEventListener('click', () => { main.innerHTML = prev; });
    main.querySelector('#as-app-settings-save').addEventListener('click', async () => {
      for (const s of settings) {
        const el = main.querySelector(`[data-key="${s.key}"]`);
        if (!el) continue;
        const val = s.type === 'checkbox' ? el.checked : (s.type === 'number' ? Number(el.value) : el.value);
        await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [s.key, JSON.stringify(val)]);
      }
      // let the app save its extra settings too
      const def3 = mvmOS._apps?.[appId];
      if (typeof def3?.saveSettingsExtra === 'function') {
        await def3.saveSettingsExtra(main);
      }
      window.dispatchEvent(new CustomEvent('settings-changed', { detail: { app: appId } }));
      main.innerHTML = prev;
    });
  }

  // ── Linux packages ────────────────────────────────────────────────────────
  async function loadCategories(body) {
    const grid = body.querySelector('#as-cat-grid');
    grid.innerHTML = `<div class="as-loading">${t('appstore_loading_categories')}</div>`;
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    if (!pkgs.length) { list.innerHTML = `<div class="as-loading">${t('appstore_no_results')}</div>`; return; }
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
    detailBody.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
          badge.textContent = t('appstore_installed_badge');
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
    title.textContent = action === 'install' ? t('as_pkg_installing', {pkg: pkgName}) : t('as_pkg_removing', {pkg: pkgName});
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
            ? (action === 'install' ? t('as_pkg_installed_ok') : t('as_pkg_removed_ok'))
            : t('as_pkg_failed', {code});
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
        panel.innerHTML = `
          <div class="as-toolbar" id="as-wstore-filter-bar-${store.id}" style="gap:6px;flex-wrap:wrap">
            <span style="font-size:.78rem;color:var(--text-dim);margin-right:4px">Show:</span>
            ${['','desktop','taskbar'].map(v => `
              <button class="s-btn-sm as-wtype-btn${v==='' ? ' active' : ''}" data-wtype="${v}"
                style="${v==='' ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}"
              >${v === '' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}</button>
            `).join('')}
          </div>
          <div class="as-list" id="as-wstore-list-${store.id}"><div class="as-loading"\>${t('loading')}</div></div>
        `;
        body.querySelector('.as-main').insertBefore(panel, body.querySelector('#as-output-wrap'));

        // filter pill click handlers
        panel.querySelectorAll('.as-wtype-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            panel.querySelectorAll('.as-wtype-btn').forEach(b => {
              b.classList.remove('active');
              b.style.background = ''; b.style.color = ''; b.style.borderColor = '';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--accent)';
            const wt = btn.dataset.wtype;
            loadWidgetStoreCategories(body, store, wt);
            body._as.refreshCurrent = () => loadWidgetStoreCategories(body, store, wt);
          });
        });
      }

      tab.addEventListener('click', () => {
        body._as.activateTab(tab);
        // apply pending filter from _applyOpts if present
        const pending = body._as._pendingWidgetFilter;
        if (pending !== undefined) {
          delete body._as._pendingWidgetFilter;
          _setWidgetFilter(body, store, pending);
        } else {
          const wt = _getWidgetFilter(body, store.id);
          loadWidgetStoreCategories(body, store, wt);
          body._as.refreshCurrent = () => loadWidgetStoreCategories(body, store, wt);
        }
      });
    });

    if (stores.length) {
      // don't auto-activate if my-widgets or my-themes tab is pending
      if (!body._as._suppressWidgetStoreAutoActivate) {
        const firstTab = tabsEl.querySelector('.as-tab');
        if (firstTab) body._as.activateTab(firstTab);
        const pending = body._as._pendingWidgetFilter;
        if (pending !== undefined) {
          delete body._as._pendingWidgetFilter;
          _setWidgetFilter(body, stores[0], pending);
        } else {
          const wt = _getWidgetFilter(body, stores[0].id);
          loadWidgetStoreCategories(body, stores[0], wt);
          body._as.refreshCurrent = () => loadWidgetStoreCategories(body, stores[0], wt);
        }
      }
    }
  }

  function _getWidgetFilter(body, storeId) {
    const active = body.querySelector(`#as-wstore-filter-bar-${storeId} .as-wtype-btn.active`);
    return active ? active.dataset.wtype : '';
  }

  function _setWidgetFilter(body, store, wt) {
    const bar = body.querySelector(`#as-wstore-filter-bar-${store.id}`);
    if (bar) {
      bar.querySelectorAll('.as-wtype-btn').forEach(b => {
        const match = b.dataset.wtype === wt;
        b.classList.toggle('active', match);
        b.style.background = match ? 'var(--accent)' : '';
        b.style.color = match ? '#fff' : '';
        b.style.borderColor = match ? 'var(--accent)' : '';
      });
    }
    loadWidgetStoreCategories(body, store, wt);
    body._as.refreshCurrent = () => loadWidgetStoreCategories(body, store, wt);
  }

  async function loadWidgetStoreCategories(body, store, widgetType) {
    const list = body.querySelector(`#as-wstore-list-${store.id}`);
    if (!list) return;
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const params = `store_id=${store.id}${widgetType ? `&widget_type=${widgetType}` : ''}`;
    const res = await fetch(`/api/widgets/categories?${params}`);
    const data = await res.json();
    if (data.error) { list.innerHTML = `<div class="as-loading">Error: ${data.error}</div>`; return; }

    const cats = data.categories || [];
    if (!cats.length) { list.innerHTML = `<div class="as-loading">${t('wstore_no_widgets')}</div>`; return; }

    list.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:4px 0';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px 12px;cursor:pointer;text-align:center;transition:background .15s';
      card.innerHTML = `
        <div style="font-size:1.8rem;line-height:1;height:2rem;display:flex;align-items:center;justify-content:center;margin-bottom:8px">${cat.icon || '🔲'}</div>
        <div style="font-weight:600;color:var(--text);font-size:.83rem">${cat.name}</div>
        <div style="color:var(--text-dim);font-size:.75rem;margin-top:4px"></div>
      `;
      card.addEventListener('mouseenter', () => card.style.background = 'var(--surface)');
      card.addEventListener('mouseleave', () => card.style.background = 'var(--surface2)');
      card.addEventListener('click', () => loadWidgetCategoryItems(body, store, cat, list, widgetType));
      grid.appendChild(card);
    });
    list.appendChild(grid);
  }

  async function loadWidgetCategoryItems(body, store, cat, list, widgetType) {
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/widgets');
    const widgets = await res.json();
    const pendingId = body._as?._pendingWidgetSettings;
    if (pendingId) {
      delete body._as._pendingWidgetSettings;
      delete body._as._suppressWidgetStoreAutoActivate;
    }
    if (!widgets.length) { list.innerHTML = `<div class="as-loading">${t('wstore_no_installed')}</div>`; return; }
    renderWidgetRows(list, widgets.map(w => ({ ...w, installed: true })), body);
    if (pendingId) {
      const def = window.mvmOS?._widgets?.[pendingId];
      const wData = widgets.find(w => w.id === pendingId);
      if (def && wData) renderWidgetSettingsPage(body, { ...wData, ...def });
    }
  }

  async function loadWidgetInstalled(body) {
    const list = body.querySelector('#as-widget-installed-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/widgets');
    const widgets = await res.json();
    if (!widgets.length) { list.innerHTML = `<div class="as-loading">${t('wstore_no_installed')}</div>`; return; }
    renderWidgetRows(list, widgets.map(w => ({ ...w, installed: true })), body);
  }

  async function loadWidgetStores(body) {
    const list = body.querySelector('#as-wstores-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    if (!name || !url) { err.textContent = t('um_name_url_required2'); return; }
    err.textContent = t('appstore_checking');
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
            ${w.installed ? `<span class="as-installed-badge">${t('appstore_installed_badge')}</span>` : ''}
            ${w.update_available ? '<span class="as-update-badge">Update</span>' : ''}
          </div>
          <span class="as-pkg-desc">${w.description || ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-left:10px;flex-shrink:0">
          ${w.update_available ? `<button class="s-btn s-btn-sm ws-update" data-widget='${JSON.stringify(w)}'>${t('um_update_btn')}</button>` : ''}
          ${w.installed
            ? `<button class="s-btn s-btn-sm ws-settings" data-id="${w.id}" data-widget-settings-id="${w.id}">${t('wstore_settings')}</button>
               <button class="s-btn s-btn-sm s-btn-danger ws-remove" data-id="${w.id}">${t('remove')}</button>`
            : `<button class="s-btn s-btn-sm ws-install" data-widget='${JSON.stringify(w)}'>${t('appstore_install')}</button>`}
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
          btn.disabled = false; btn.textContent = label.startsWith('Install') ? t('appstore_install') : '↑ ' + t('appstore_update');
          alert('Failed: ' + (result.error || 'unknown'));
        }
      }

      row.querySelector('.ws-install')?.addEventListener('click', e => {
        doWidgetInstall(JSON.parse(e.target.dataset.widget), e.target, t('um_installing'));
      });
      row.querySelector('.ws-update')?.addEventListener('click', e => {
        doWidgetInstall(JSON.parse(e.target.dataset.widget), e.target, 'Updating…');
      });
      row.querySelector('.ws-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = t('um_removing');
        await fetch(`/api/widgets/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeWidget(btn.dataset.id);
        body._as.refreshCurrent?.();
      });

      row.querySelector('.ws-settings')?.addEventListener('click', e => {
        renderWidgetSettingsPage(body, w);
      });

      list.appendChild(row);
    });
  }

  function renderWidgetSettings(container, widgetId) {
    const w = window.mvmOS?._widgets?.[widgetId];
    if (w) renderWidgetSettingsPage(container._body || document.querySelector('.window[data-win-id="appstore"] .window-body'), w);
  }

  async function renderWidgetSettingsPage(body, w) {
    const widgetId = w.id;
    const def = window.mvmOS?._widgets?.[widgetId];
    const settings = def?.settings || [];
    const useDb = !!def?.useDb;
    const main = body.querySelector('.as-main');
    const prevContent = main.innerHTML;

    // show loading while reading db values
    main.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${t('loading')}</div>`;

    let _dbVals = {};
    if (useDb) {
      try {
        const db = mvmOS.widgetDb(widgetId);
        await db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
        const rows = await db.query('SELECT key, value FROM settings');
        rows.forEach(r => { try { _dbVals[r.key] = JSON.parse(r.value); } catch(_) {} });
      } catch(_) {}
    }

    function _storageKey(s) { return `widget_${widgetId}_${s.key}`; }
    function _savedVal(s) {
      if (useDb) return _dbVals[s.key] !== undefined ? _dbVals[s.key] : (s.default !== undefined ? s.default : '');
      const v = mvmOS.storage.get(_storageKey(s));
      return v !== null ? v : (s.default !== undefined ? s.default : '');
    }
    function _savedCountry() {
      if (useDb) return _dbVals['country'] !== undefined ? _dbVals['country'] : '';
      return mvmOS.storage.get(`widget_${widgetId}_country`) || '';
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto';

    const toolbar = document.createElement('div');
    toolbar.className = 'as-toolbar';
    toolbar.style.flexShrink = '0';
    toolbar.innerHTML = `
      <button class="s-btn s-btn-sm" id="ws-settings-back">${t('as_back')}</button>
      <span style="font-weight:600;font-size:.9rem;margin-left:8px">${w.icon || ''} ${w.name} — ${t('wstore_settings_title')}</span>`;
    wrap.appendChild(toolbar);

    const content = document.createElement('div');
    content.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:14px;flex:1';

    if (!settings.length) {
      content.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem">${t('wstore_no_settings')}</div>`;
    } else {
      settings.forEach(s => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:.85rem';

        if (s.type === 'checkbox') {
          const val = _savedVal(s);
          row.innerHTML = `
            <input type="checkbox" id="ws-${widgetId}-${s.key}" ${val ? 'checked' : ''}>
            <label for="ws-${widgetId}-${s.key}">${s.label}</label>`;
        } else if (s.type === 'select') {
          const val = _savedVal(s);
          row.innerHTML = `
            <label style="flex:1">${s.label}</label>
            <select id="ws-${widgetId}-${s.key}" class="s-input" style="width:auto">
              ${(s.options || []).map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}
            </select>`;
        } else if (s.type === 'city') {
          const val = _savedVal(s);
          const ccVal = _savedCountry();
          row.style.cssText += ';flex-direction:column;align-items:stretch;gap:8px';
          row.innerHTML = `
            <label style="font-size:.85rem">${s.label}</label>
            <div style="position:relative">
              <input type="text" id="ws-${widgetId}-${s.key}" class="s-input" value="${val}"
                placeholder="Type to search…" autocomplete="off" style="width:100%;box-sizing:border-box">
              <div id="ws-ac-${widgetId}-${s.key}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface2);border:1px solid var(--border);border-radius:6px;z-index:9999;max-height:160px;overflow-y:auto;box-shadow:var(--shadow)"></div>
            </div>
            <input type="hidden" id="ws-${widgetId}-country" value="${ccVal}">`;
          content.appendChild(row);

          const inp  = row.querySelector(`#ws-${widgetId}-${s.key}`);
          const ccEl = row.querySelector(`#ws-${widgetId}-country`);
          const drop = row.querySelector(`#ws-ac-${widgetId}-${s.key}`);
          let _acTimer = null;

          inp.addEventListener('input', () => {
            clearTimeout(_acTimer);
            const q = inp.value.trim();
            if (q.length < 2) { drop.style.display = 'none'; return; }
            _acTimer = setTimeout(async () => {
              try {
                const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`);
                const j = await res.json();
                const results = j.results || [];
                drop.innerHTML = results.map((r, i) =>
                  `<div data-i="${i}" style="padding:7px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border)"
                    data-name="${r.name}" data-cc="${r.country_code || ''}">
                    <strong>${r.name}</strong> <span style="color:var(--text-dim)">${r.admin1 ? r.admin1 + ', ' : ''}${r.country || ''}</span>
                  </div>`
                ).join('') || `<div style="padding:8px 10px;font-size:.82rem;color:var(--text-dim)">No results</div>`;
                drop.style.display = 'block';
                drop.querySelectorAll('[data-i]').forEach(el => {
                  el.addEventListener('mouseenter', () => el.style.background = 'var(--surface)');
                  el.addEventListener('mouseleave', () => el.style.background = '');
                  el.addEventListener('mousedown', e => {
                    e.preventDefault();
                    inp.value = el.dataset.name;
                    ccEl.value = el.dataset.cc;
                    drop.style.display = 'none';
                  });
                });
              } catch(_) {}
            }, 300);
          });
          inp.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 200));
          return;
        } else {
          const val = _savedVal(s);
          row.innerHTML = `
            <label style="flex:1">${s.label}</label>
            <input type="${s.type || 'text'}" id="ws-${widgetId}-${s.key}" class="s-input"
              value="${val}" ${s.min !== undefined ? `min="${s.min}"` : ''} ${s.max !== undefined ? `max="${s.max}"` : ''}
              style="width:100px">`;
        }
        content.appendChild(row);
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px';
      btnRow.innerHTML = `
        <button class="s-btn s-btn-sm" id="ws-settings-cancel">${t('as_cancel_btn')}</button>
        <button class="s-btn s-btn-sm" id="ws-settings-save">${t('wstore_settings_save')}</button>`;
      content.appendChild(btnRow);
    }

    wrap.appendChild(content);
    main.innerHTML = '';
    main.appendChild(wrap);

    main.querySelector('#ws-settings-back')?.addEventListener('click', () => {
      main.innerHTML = prevContent;
      body._as.refreshCurrent?.();
    });
    main.querySelector('#ws-settings-cancel')?.addEventListener('click', () => {
      main.innerHTML = prevContent;
      body._as.refreshCurrent?.();
    });
    main.querySelector('#ws-settings-save')?.addEventListener('click', async () => {
      const useDb = !!(window.mvmOS?._widgets?.[widgetId]?.useDb);
      const db = useDb ? mvmOS.widgetDb(widgetId) : null;
      if (db) await db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

      async function _save(key, val) {
        if (db) await db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, JSON.stringify(val)]);
        else mvmOS.storage.set(`widget_${widgetId}_${key}`, val);
      }

      for (const s of settings) {
        if (s.type === 'city') {
          const cityEl = main.querySelector(`#ws-${widgetId}-${s.key}`);
          const ccEl   = main.querySelector(`#ws-${widgetId}-country`);
          if (cityEl) await _save(s.key, cityEl.value.trim());
          if (ccEl)   await _save('country', ccEl.value.trim());
        } else {
          const el = main.querySelector(`#ws-${widgetId}-${s.key}`);
          if (!el) continue;
          const val = s.type === 'checkbox' ? el.checked : (s.type === 'number' ? parseFloat(el.value) : el.value);
          await _save(s.key, val);
        }
      }
      window.dispatchEvent(new CustomEvent('widget-settings-changed', { detail: { id: widgetId } }));
      main.innerHTML = prevContent;
      body._as.refreshCurrent?.();
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
      panel.innerHTML = `<div class="as-list as-cat-grid" id="as-tcat-grid-${Date.now()}"><div class="as-loading"\>${t('loading')}</div></div>`;
      main.appendChild(panel);
      if (tab) tab._panel = panel;
    }
    body.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
    panel.classList.add('active');

    const gridEl = panel.querySelector('[id^="as-tcat-grid"]');
    gridEl.innerHTML = `<div class="as-loading">${t('loading')}</div>`;

    const res = await fetch('/api/themes/categories');
    const cats = await res.json();

    if (!cats.length) { gridEl.innerHTML = `<div class="as-loading">${t('appstore_no_categories')}</div>`; return; }

    gridEl.innerHTML = cats.map(c => `
      <div class="as-cat-card" data-manifest="${c.manifest_url}">
        <div class="as-cat-icon" style="height:2rem;display:flex;align-items:center;justify-content:center">${c.icon}</div>
        <div class="as-cat-label">${c.name}</div>
      </div>
    `).join('');

    gridEl.querySelectorAll('.as-cat-card').forEach(card => {
      card.addEventListener('click', () => loadThemeCategoryItems(body, card.dataset.manifest, panel, storeId));
    });
  }

  async function loadThemeCategoryItems(body, manifestUrl, panel, storeId) {
    const gridEl = panel.querySelector('[id^="as-tcat-grid"]');
    gridEl.innerHTML = `<div class="as-loading">${t('loading')}</div>`;

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
    backBtn.innerHTML = `<button class="s-btn-sm">${t('as_back')}</button>`;
    backBtn.querySelector('button').addEventListener('click', async () => {
      const catRes2 = await fetch('/api/themes/categories');
      const cats2 = await catRes2.json();
      gridEl.innerHTML = cats2.map(c => `
        <div class="as-cat-card" data-manifest="${c.manifest_url}">
          <div class="as-cat-icon" style="height:2rem;display:flex;align-items:center;justify-content:center">${c.icon}</div>
          <div class="as-cat-label">${c.name}</div>
        </div>
      `).join('');
      gridEl.querySelectorAll('.as-cat-card').forEach(card => {
        card.addEventListener('click', () => loadThemeCategoryItems(body, card.dataset.manifest, panel, storeId));
      });
    });
    gridEl.appendChild(backBtn);

    if (!items.length) { gridEl.innerHTML += `<div class="as-loading">${t('tstore_no_themes')}</div>`; return; }

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
        btn.disabled = true; btn.textContent = t('loading');
        const data = JSON.parse(btn.dataset.theme);
        const res = await fetch('/api/themes/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if ((await res.json()).ok) {
          body._as.refreshCurrent?.();
          loadThemeCategoryItems(body, manifestUrl, panel, storeId);
        } else { btn.disabled = false; btn.textContent = t('appstore_install'); }
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
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/themes');
    const themes = await res.json();
    if (!themes.length) { list.innerHTML = `<div class="as-loading">${t('tstore_no_installed')}</div>`; return; }
    _renderThemeRows(list, themes, () => loadThemeInstalled(body));
  }

  async function loadMyThemes(body) {
    const list = body.querySelector('#as-my-themes-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const [themesRes, storesRes] = await Promise.all([fetch('/api/themes'), fetch('/api/themes/stores')]);
    const themes = await themesRes.json();
    const stores = await storesRes.json();
    const officialIds = new Set(stores.filter(s => s.official).map(s => s.id));
    const custom = themes.filter(t => t.store_id && !officialIds.has(t.store_id));
    if (!custom.length) { list.innerHTML = `<div class="as-loading">${t('tstore_no_custom')}</div>`; return; }
    _renderThemeRows(list, custom, () => loadMyThemes(body));
  }

  async function loadThemeStores(body) {
    const list = body.querySelector('#as-tstores-list');
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
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
    if (!name || !url) { err.textContent = t('um_name_url_required2'); return; }
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

// ── Update Manager ────────────────────────────────────────────────────────────
const UpdateManager = (() => {
  function openWindow() {
    const existing = document.querySelector('.window[data-win-id="update-manager"]');
    if (existing) { Desktop.focusWindow('update-manager'); return; }
    Desktop.createWindow({
      id: 'update-manager',
      title: `🔄 ${t('um_title')}`,
      width: 600,
      height: 460,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => render(body)); },
    });
  }

  function render(body) {
    body.style.padding = '0';
    body.style.overflow = 'hidden';
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="display:flex;border-bottom:1px solid var(--border)">
          <button class="um-tab active" data-tab="mvmos" style="flex:1;padding:10px;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--text);font-size:.82rem;cursor:pointer">${t('um_title')} — mvmOS</button>
          <button class="um-tab" data-tab="system" style="flex:1;padding:10px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-dim);font-size:.82rem;cursor:pointer">${t('um_linux_packages')}</button>
        </div>

        <div id="um-panel-mvmos" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.8rem;color:var(--text-dim)" id="um-mvmos-status">${t('appstore_checking')}</span>
            <button class="s-btn s-btn-sm" id="um-mvmos-all" style="display:none">${t('um_update_all')}</button>
          </div>
          <div id="um-mvmos-list" style="flex:1;overflow-y:auto;padding:6px 0"></div>
        </div>

        <div id="um-panel-system" style="display:none;flex-direction:column;flex:1;overflow:hidden">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span style="font-size:.8rem;color:var(--text-dim)" id="um-sys-status">${t('um_click_refresh')}</span>
            <div style="display:flex;gap:6px;align-items:center">
              <label style="font-size:.78rem;color:var(--text-dim);display:flex;align-items:center;gap:4px;cursor:pointer">
                <input type="checkbox" id="um-sys-show-all"> ${t('um_linux_packages')}
              </label>
              <button class="s-btn s-btn-sm" id="um-sys-refresh">${t('um_refresh_btn')}</button>
              <button class="s-btn s-btn-sm" id="um-sys-all" style="display:none">${t('um_update_all')}</button>
            </div>
          </div>
          <div id="um-sys-list" style="flex:1;overflow-y:auto;padding:6px 0;min-height:0">
            <div class="as-loading">${t('um_refresh')}</div>
          </div>
          <div id="um-sys-log" style="display:none;flex-shrink:0;height:120px;background:#0d1117;border-top:1px solid var(--border);overflow-y:auto;padding:6px 10px;font-family:var(--mono);font-size:.72rem;color:#a6e3a1;white-space:pre-wrap;word-break:break-all"></div>
        </div>
      </div>
    `;

    // ── Tab switching ────────────────────────────────────────────────────────
    body.querySelectorAll('.um-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        body.querySelectorAll('.um-tab').forEach(t => {
          t.classList.remove('active');
          t.style.borderBottomColor = 'transparent';
          t.style.color = 'var(--text-dim)';
        });
        tab.classList.add('active');
        tab.style.borderBottomColor = 'var(--accent)';
        tab.style.color = 'var(--text)';
        body.querySelector('#um-panel-mvmos').style.display = tab.dataset.tab === 'mvmos' ? 'flex' : 'none';
        body.querySelector('#um-panel-system').style.display = tab.dataset.tab === 'system' ? 'flex' : 'none';
        if (tab.dataset.tab === 'system' && !body._sysFetched) {
          body._sysFetched = true;
          body.querySelector('#um-sys-refresh').click();
        }
      });
    });

    // ── mvmOS Updates ────────────────────────────────────────────────────────
    let mvmosUpdates = [];
    const mvmosList   = body.querySelector('#um-mvmos-list');
    const mvmosStatus = body.querySelector('#um-mvmos-status');
    const mvmosAllBtn = body.querySelector('#um-mvmos-all');

    async function loadMvmOS() {
      mvmosList.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
      const res = await fetch('/api/updates');
      mvmosUpdates = await res.json();
      renderMvmOS();
    }

    function renderMvmOS() {
      if (!mvmosUpdates.length) {
        mvmosStatus.textContent = t('um_up_to_date');
        mvmosAllBtn.style.display = 'none';
        mvmosList.innerHTML = `<div class="as-loading" style="padding-top:40px">${t('um_no_updates')}</div>`;
        return;
      }
      const s = mvmosUpdates.length !== 1 ? 's' : '';
      mvmosStatus.textContent = t('um_updates_available', { n: mvmosUpdates.length, s });
      mvmosAllBtn.style.display = '';
      mvmosList.innerHTML = '';
      mvmosUpdates.forEach(u => {
        const row = document.createElement('div');
        row.className = 'as-pkg-row';
        row.dataset.uid = u.id + '_' + u.type;
        row.innerHTML = `
          <div style="font-size:1.4rem;width:28px;text-align:center;flex-shrink:0">${u.icon}</div>
          <div class="as-pkg-info">
            <div class="as-pkg-top">
              <span class="as-pkg-name">${u.name}</span>
              <span style="font-size:.7rem;color:var(--text-dim);margin-left:6px">${u.type}</span>
            </div>
            <div class="as-pkg-desc">${u.description || ''}</div>
            <div class="as-pkg-ver">${u.current_version} → <span style="color:var(--accent)">${u.new_version}</span></div>
          </div>
          <div class="as-pkg-actions">
            <button class="s-btn s-btn-sm um-update-btn">${t('um_update_btn')}</button>
          </div>
        `;
        row.querySelector('.um-update-btn').addEventListener('click', async e => {
          const btn = e.target; btn.disabled = true; btn.textContent = t('um_updating');
          await doMvmOSUpdate(u);
          mvmosUpdates = mvmosUpdates.filter(x => !(x.id === u.id && x.type === u.type));
          row.remove();
          renderMvmOS();
        });
        mvmosList.appendChild(row);
      });
    }

    mvmosAllBtn.addEventListener('click', async () => {
      mvmosAllBtn.disabled = true; mvmosAllBtn.textContent = t('um_updating');
      for (const u of [...mvmosUpdates]) {
        const row = mvmosList.querySelector(`[data-uid="${u.id}_${u.type}"]`);
        const btn = row?.querySelector('.um-update-btn');
        if (btn) { btn.disabled = true; btn.textContent = t('um_updating'); }
        await doMvmOSUpdate(u);
        row?.remove();
      }
      mvmosUpdates = [];
      renderMvmOS();
    });

    loadMvmOS();

    // ── System Packages ───────────────────────────────────────────────────────
    let sysPkgs = [];
    const sysList    = body.querySelector('#um-sys-list');
    const sysStatus  = body.querySelector('#um-sys-status');
    const sysAllBtn  = body.querySelector('#um-sys-all');
    const sysRefresh = body.querySelector('#um-sys-refresh');
    const sysShowAll = body.querySelector('#um-sys-show-all');

    function renderSys() {
      const showAll = sysShowAll.checked;
      const visible = showAll ? sysPkgs : sysPkgs.filter(p => p.is_app);
      if (!visible.length) {
        sysStatus.textContent = showAll ? t('um_no_sys_updates') : t('um_no_app_updates2');
        sysAllBtn.style.display = 'none';
        sysList.innerHTML = `<div class="as-loading" style="padding-top:40px">${showAll ? t('um_no_updates') : t('um_no_app_updates')}</div>`;
        return;
      }
      const s2 = visible.length !== 1 ? 's' : '';
      const hidden = !showAll && sysPkgs.length > visible.length ? ' ' + t('um_sys_hidden', { n: sysPkgs.length - visible.length }) : '';
      sysStatus.textContent = t('um_updates_available', { n: visible.length, s: s2 }) + hidden;
      sysAllBtn.style.display = '';
      sysList.innerHTML = '';
      visible.forEach(p => {
        const row = document.createElement('div');
        row.className = 'as-pkg-row';
        row.dataset.pkg = p.name;
        row.innerHTML = `
          <div style="font-size:1.1rem;width:28px;text-align:center;flex-shrink:0">📦</div>
          <div class="as-pkg-info">
            <div class="as-pkg-top"><span class="as-pkg-name">${p.name}</span></div>
            <div class="as-pkg-desc">${p.description || ''}</div>
            <div class="as-pkg-ver">${p.current_version} → <span style="color:var(--accent)">${p.new_version}</span></div>
          </div>
          <div class="as-pkg-actions">
            <button class="s-btn s-btn-sm um-sys-update-btn">${t('um_update_btn')}</button>
          </div>
        `;
        row.querySelector('.um-sys-update-btn').addEventListener('click', async e => {
          const btn = e.target; btn.disabled = true; btn.textContent = t('um_updating');
          await doSysUpdate(p.name, body.querySelector('#um-sys-log'));
          sysPkgs = sysPkgs.filter(x => x.name !== p.name);
          row.remove();
          renderSys();
        });
        sysList.appendChild(row);
      });
    }

    sysRefresh.addEventListener('click', async () => {
      sysRefresh.disabled = true; sysRefresh.textContent = '↺ ' + t('appstore_checking');
      sysList.innerHTML = `<div class="as-loading">${t('um_apt_update')}</div>`;
      const res = await fetch('/api/packages/upgradable');
      sysPkgs = await res.json();
      sysRefresh.disabled = false; sysRefresh.textContent = t('um_refresh_btn');
      renderSys();
    });

    sysShowAll.addEventListener('change', renderSys);

    sysAllBtn.addEventListener('click', async () => {
      sysAllBtn.disabled = true; sysAllBtn.textContent = t('um_updating');
      const showAll = sysShowAll.checked;
      const toUpdate = showAll ? [...sysPkgs] : sysPkgs.filter(p => p.is_app);
      const logEl = body.querySelector('#um-sys-log');
      for (const p of toUpdate) {
        const row = sysList.querySelector(`[data-pkg="${p.name}"]`);
        const btn = row?.querySelector('.um-sys-update-btn');
        if (btn) { btn.disabled = true; btn.textContent = t('um_updating'); }
        await doSysUpdate(p.name, logEl);
        sysPkgs = sysPkgs.filter(x => x.name !== p.name);
        row?.remove();
      }
      sysAllBtn.disabled = false; sysAllBtn.textContent = t('um_update_all');
      renderSys();
    });
  }

  async function doMvmOSUpdate(u) {
    if (u.type === 'app') {
      await fetch('/api/plugins/install', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: u.id, name: u.name, icon: u.icon, category: u.category,
          version: u.new_version, description: u.description, base_url: u.base_url,
          js_url: u.js_url, store_id: u.store_id }) });
    } else if (u.type === 'widget') {
      await fetch('/api/widgets/install', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: u.id, name: u.name, icon: u.icon, version: u.new_version,
          description: u.description, widget_type: u.widget_type, base_url: u.base_url,
          js_url: u.js_url, store_id: u.store_id }) });
    } else if (u.type === 'theme') {
      await fetch('/api/themes/install', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: u.id, name: u.name, icon: u.icon, version: u.new_version,
          description: u.description, base_url: u.base_url, store_id: u.store_id }) });
    }
  }

  async function doSysUpdate(name, logEl) {
    if (logEl) { logEl.style.display = 'block'; logEl.textContent += `\n$ apt-get install --only-upgrade ${name}\n`; logEl.scrollTop = logEl.scrollHeight; }
    await new Promise(async resolve => {
      const res = await fetch('/api/packages/upgrade', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const text = line.slice(6);
          if (text.startsWith('__EXIT_')) { resolve(); return; }
          if (logEl) { logEl.textContent += text + '\n'; logEl.scrollTop = logEl.scrollHeight; }
        }
      }
      resolve();
    });
  }

  return { openWindow, render };
})();
