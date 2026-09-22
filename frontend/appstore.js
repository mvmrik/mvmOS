// ── App Store ────────────────────────────────────────────────────────────────

const AppStore = (() => {

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
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => { render(body, opts); if (opts) _applyOpts(body, opts); Desktop.initMobileSidebar(body); }); },
    });
  }

  function _applyOpts(body, opts) {
    if (typeof opts === 'string') {
      body?.querySelector?.(`.as-tab[data-tab="${opts}"]`)?.click();
    } else if (opts?.section === 'widgets') {
      const tab = body.querySelector('.as-tab[data-tab="wstore"]');
      if (tab) { body._as._enter = { widgets: opts.widgetType || '' }; tab.click(); }
    } else if (opts?.section === 'widget-settings') {
      const tab = body.querySelector('.as-tab[data-tab="widget-installed"]');
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
      body.querySelector('.as-tab[data-tab="tstore"]')?.click();
    }
  }

  // ── Render shell ──────────────────────────────────────────────────────────
  function render(body, opts) {
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

          <div class="as-tab" data-tab="store">🏪 ${t('appstore_tab_store')}</div>
          <div class="as-tab" data-tab="app-installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="app-stores">🔗 ${t('as_stores')}</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">${t('as_mvmos_widgets')}</div>
          <div class="as-tab" data-tab="wstore">🏪 ${t('appstore_tab_store')}</div>
          <div class="as-tab" data-tab="widget-installed">✅ ${t('as_installed')}</div>
          <div class="as-tab" data-tab="widget-stores">🔗 ${t('as_stores')}</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-sidebar-group-label">${t('as_mvmos_themes')}</div>
          <div class="as-tab" data-tab="tstore">🏪 ${t('appstore_tab_store')}</div>
          <div class="as-tab" data-tab="theme-installed">✅ ${t('as_installed')}</div>
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

          <!-- Merged stores: apps, widgets, themes -->
          <div class="as-panel" id="asp-store"><div class="as-list" id="as-store-list"></div></div>
          <div class="as-panel" id="asp-wstore"><div class="as-list" id="as-wstore-list"></div></div>
          <div class="as-panel" id="asp-tstore"><div class="as-list" id="as-tstore-list"></div></div>

          <!-- App Installed -->
          <div class="as-panel" id="asp-app-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">${t('as_installed_apps_label')}</span>
              <button class="s-btn" id="as-app-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="as-app-installed-list"><div class="as-loading"\>${t('loading')}</div></div>
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
        const merged = { store: 'apps', wstore: 'widgets', tstore: 'themes' }[tab.dataset.tab];
        if (merged) {
          const enter = body._as._enter?.[merged] || '';
          if (body._as._enter) delete body._as._enter[merged];
          loadMergedStore(body, merged, { enter });
        }
        if (tab.dataset.tab === 'app-installed') { loadAppInstalled(body); body._as.refreshCurrent = () => loadAppInstalled(body); }
        if (tab.dataset.tab === 'app-stores') loadStores(body);
        if (tab.dataset.tab === 'browse' && !_browsedLoaded) { _browsedLoaded = true; loadCategories(body); }
        if (tab.dataset.tab === 'installed' && !_installedLoaded) { _installedLoaded = true; loadInstalled(body); }
        if (tab.dataset.tab === 'widget-installed') { loadWidgetInstalled(body); body._as.refreshCurrent = () => loadWidgetInstalled(body); }
        if (tab.dataset.tab === 'widget-stores') loadWidgetStores(body);
        if (tab.dataset.tab === 'theme-installed') { loadThemeInstalled(body); body._as.refreshCurrent = () => loadThemeInstalled(body); }
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

    // ── App Installed refresh ──
    body.querySelector('#as-app-installed-refresh').addEventListener('click', () => loadAppInstalled(body));

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
    body.querySelector('#as-tstores-add-btn').addEventListener('click', () => {
      const form = body.querySelector('#as-add-tstore-form');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    body.querySelector('#as-tstore-cancel').addEventListener('click', () => {
      body.querySelector('#as-add-tstore-form').style.display = 'none';
    });
    body.querySelector('#as-tstore-submit').addEventListener('click', () => submitAddThemeStore(body));

    body._as = { browseState, activateTab, refreshCurrent: null };

    // Open the app store first, unless the caller asked for something else
    // (_applyOpts runs right after render and may already have picked a tab).
    const _initSection = opts?.section;
    setTimeout(() => {
      if (!body.isConnected || body.querySelector('.as-tab.active') || body._as._suppressWidgetStoreAutoActivate) return;
      if (!_initSection || _initSection === 'apps') body.querySelector('.as-tab[data-tab="store"]')?.click();
    }, 0);
  }

  // ── Merged store (apps, widgets, themes) ──────────────────────────────────
  // Every store of a kind — the official one and any the owner added — is
  // browsed as ONE category tree, so nobody has to know which store holds what.
  // The server does the merging (same-named categories become one, the official
  // store wins a duplicated id, see backend/storemerge.py); this only draws it.
  // Official items carry ⚡, everything else 📦 and the name of its store.
  const _escHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function sourceMark(item) {
    if (item.official) return `<span class="as-src as-src-official" title="${_escHtml(t('appstore_official'))}">⚡</span>`;
    if (item.store_name) return `<span class="as-src" title="${_escHtml(item.store_name)}">📦 ${_escHtml(item.store_name)}</span>`;
    return '';
  }

  // Store apps that have a Premium half are marked in the list already; the manifest
  // says so with "premium": true. What Premium adds is read from the store itself
  // (premium.json next to the app's sources) when the app's page is opened.
  function premiumMark() {
    return `<span class="as-premium-mark" title="${_escHtml(t('appstore_premium_title'))}">💎</span>`;
  }

  async function loadPremiumSection(el, app) {
    const info = await fetch(`/api/plugins/${encodeURIComponent(app.id)}/premium?store_id=${encodeURIComponent(app.store_id || 0)}`)
      .then(r => r.json()).catch(() => ({}));
    if (!el.isConnected) return;
    const features = Array.isArray(info.features) ? info.features : [];
    const active = window.mvmOS?.premiumStatus === 'premium';
    el.innerHTML = `
      <h3>💎 ${_escHtml(t('appstore_premium_title'))}</h3>
      <p class="as-premium-summary">${_escHtml(info.summary || t('appstore_premium_generic'))}</p>
      ${features.length ? `<div class="as-premium-features">${features.map(f => {
        const head = `<b>${_escHtml(f.title)}</b>${f.short ? `<span>${_escHtml(f.short)}</span>` : ''}`;
        // The full text opens on click, so a long description does not push the reviews away.
        return f.description && f.description !== f.short
          ? `<details><summary>${head}</summary><p>${_escHtml(f.description)}</p></details>`
          : `<div class="as-premium-feature">${head}</div>`;
      }).join('')}</div>` : ''}
      ${active
        ? `<div class="as-premium-active">✔ ${_escHtml(t('appstore_premium_active'))}</div>`
        : `<button class="s-btn s-btn-sm s-btn-primary as-premium-get" type="button">${_escHtml(t('appstore_premium_get'))}</button>`}`;
    el.querySelector('.as-premium-get')?.addEventListener('click',
      () => window.dispatchEvent(new CustomEvent('open-subscription-settings')));
  }

  const MERGED_STORES = {
    apps: {
      url: '/api/plugins/store', list: '#as-store-list', icon: '📦', empty: 'wstore_no_categories',
      render: (el, items, body) => { el.className = 'as-app-grid'; renderMvmosApps(el, items, body); },
    },
    widgets: {
      url: '/api/widgets/store', list: '#as-wstore-list', icon: '🔲', empty: 'wstore_no_widgets',
      render: (el, items, body) => renderWidgetRows(el, items, body, { browse: true }),
    },
    themes: {
      url: '/api/themes/store', list: '#as-tstore-list', icon: '🎨', empty: 'tstore_no_themes',
      render: (el, items, body) => renderThemeStoreRows(el, items, body),
    },
  };

  const _catKey = cat => String(cat.name || '').trim().toLowerCase();
  const _catName = cat => cat.id === '_other' ? t('appstore_cat_other') : cat.name;

  function _flattenItems(node, trail = []) {
    let out = (node.items || []).map(it => ({ it, cats: trail }));
    (node.categories || []).forEach(c => { out = out.concat(_flattenItems(c, trail.concat(_catName(c)))); });
    return out;
  }

  async function loadMergedStore(body, kind, { enter = '' } = {}) {
    const cfg = MERGED_STORES[kind];
    const list = body.querySelector(cfg.list);
    if (!list) return;
    let tree = null;
    let path = [];          // category names from the root down to what is open
    let query = '';

    // The search box sits outside the changing content, so it survives drilling
    // into a category and always searches every store, not just the open category.
    list.innerHTML = `
      <div class="as-toolbar">
        <input class="as-filter" type="search" placeholder="${_escHtml(t('appstore_search_store_ph'))}" autocomplete="off">
      </div>
      <div class="as-store-warn"></div>
      <div class="as-store-body"><div class="as-loading">${t('loading')}</div></div>`;
    const input = list.querySelector('.as-filter');
    const warn = list.querySelector('.as-store-warn');
    const inner = list.querySelector('.as-store-body');

    function walk() {
      let node = tree;
      const trail = [];
      for (const key of path) {
        const next = (node.categories || []).find(c => _catKey(c) === key);
        if (!next) break;
        node = next;
        trail.push(next);
      }
      // A path that no longer exists (an item vanished from its store) falls back to what is left.
      path = trail.map(_catKey);
      return { node, trail };
    }

    function tiles(cats) {
      const grid = document.createElement('div');
      grid.className = 'as-cat-grid as-cat-grid-merged';
      cats.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'as-cat-card';
        card.innerHTML = `
          <div class="as-cat-icon" style="height:2rem;display:flex;align-items:center;justify-content:center">${_escHtml(cat.icon || cfg.icon)}</div>
          <div class="as-cat-label">${_escHtml(_catName(cat))}</div>
          <div style="color:var(--text-dim);font-size:.72rem">${t('appstore_cat_count', { n: cat.count || 0 })}</div>`;
        card.addEventListener('click', () => { path.push(_catKey(cat)); show(); });
        grid.appendChild(card);
      });
      return grid;
    }

    function show() {
      inner.innerHTML = '';
      const q = query.trim().toLowerCase();
      if (q) {
        const hits = _flattenItems(tree).filter(({ it, cats }) =>
          (it.name || '').toLowerCase().includes(q) ||
          (it.id || '').toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q) ||
          cats.some(c => c.toLowerCase().includes(q))).map(h => h.it);
        const head = document.createElement('div');
        head.className = 'as-loading';
        head.textContent = hits.length ? t('appstore_search_results', { n: hits.length })
                                       : t('appstore_search_none', { q: query.trim() });
        inner.appendChild(head);
        if (hits.length) { const el = document.createElement('div'); inner.appendChild(el); cfg.render(el, hits, body); }
        return;
      }

      const { node, trail } = walk();
      if (trail.length) {
        const bar = document.createElement('div');
        bar.className = 'as-toolbar';
        bar.innerHTML = `<button class="s-btn s-btn-sm" type="button">← ${_escHtml(trail.map(_catName).join(' › '))}</button>`;
        bar.querySelector('button').addEventListener('click', () => { path.pop(); show(); });
        inner.appendChild(bar);
      }
      if (!node.categories?.length && !node.items?.length) {
        inner.insertAdjacentHTML('beforeend', `<div class="as-loading">${t(cfg.empty)}</div>`);
        return;
      }
      if (node.categories?.length) inner.appendChild(tiles(node.categories));
      if (node.items?.length) { const el = document.createElement('div'); inner.appendChild(el); cfg.render(el, node.items, body); }
    }

    async function fetchTree() {
      const res = await fetch(cfg.url);
      const data = await res.json();
      if (!Array.isArray(data.categories)) throw new Error(data.error || data.detail || t('as_invalid_response'));
      tree = { categories: data.categories, items: [] };
      warn.innerHTML = data.errors?.length
        ? `<div class="as-loading">${_escHtml(t('appstore_store_unreachable', { names: data.errors.join(', ') }))}</div>` : '';
    }

    // A refresh follows an install/remove: the tree is cached server-side, only
    // the installed flags changed, so ask again and stay where the user is.
    body._as.refreshCurrent = async () => {
      try { await fetchTree(); show(); } catch (e) { /* keep what is on screen */ }
    };
    input.addEventListener('input', (() => {
      let debounce = null;
      return () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { if (tree) { query = input.value; show(); } }, 200);
      };
    })());

    try { await fetchTree(); }
    catch (e) { inner.innerHTML = `<div class="as-loading">${t('as_error')}: ${_escHtml(e.message)}</div>`; return; }
    if (enter) {
      const want = String(enter).toLowerCase();
      const match = tree.categories.find(c => String(c.id).toLowerCase() === want || _catKey(c).includes(want));
      if (match) path = [_catKey(match)];
    }
    show();
  }

  // ── App Installed (all installed mvmOS apps) ──────────────────────────────
  async function loadAppInstalled(body) {
    const list = body.querySelector('#as-app-installed-list');
    const pendingAppId = body._as?._pendingAppSettings;
    if (pendingAppId) delete body._as._pendingAppSettings;
    list.innerHTML = `<div class="as-loading">${t('loading')}</div>`;
    const res = await fetch('/api/plugins');
    const plugins = await res.json();
    if (pendingAppId) {
      const app = plugins.find(p => p.id === pendingAppId);
      if (app) { _openAppSettings(body, pendingAppId, app); return; }
    }
    if (!plugins.length) {
      list.innerHTML = `<div class="as-loading">${t('appstore_no_installed')}</div>`;
      return;
    }
    renderMvmosApps(list, plugins.map(p => ({ ...p, installed: true })), body, { badge: false });
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
            ${store.official ? `<span class="as-installed-badge">${t('appstore_official')}</span>` : ''}
          </div>
          <span class="as-pkg-desc" style="font-family:monospace;font-size:.73rem">${store.manifest_url}</span>
        </div>
        ${!store.official ? `<button class="s-btn s-btn-sm s-btn-danger as-store-remove" data-id="${store.id}" style="flex-shrink:0;margin-left:8px">${t('appstore_remove')}</button>` : ''}
      `;
      row.querySelector('.as-store-remove')?.addEventListener('click', async e => {
        if (!confirm(`Remove store "${store.name}"?`)) return;
        await fetch(`/api/plugins/stores/${store.id}`, { method: 'DELETE' });
        loadStores(body);
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
  }

  // ── mvmOS app row renderer ────────────────────────────────────────────────
  // Installing, updating and reinstalling share one flow. Returns true when the
  // app ended up installed, false when it was cancelled or failed (the button is restored).
  async function installMvmosApp(body, appData, btn, label) {
    const restore = () => { btn.disabled = false; btn.textContent = btn.dataset.orig || t('appstore_install'); };
    if (!appData.official) {
      const ok = confirm(
        `⚠️ Third-party app\n\n` +
        `"${appData.name}" is from an unofficial store.\n\n` +
        `mvmOS does not verify third-party apps. Install only from sources you trust. ` +
        `The author is solely responsible for the app's content.\n\n` +
        `Install anyway?`
      );
      if (!ok) return false;
    }
    btn.disabled = true; btn.textContent = label;
    const post = extra => fetch('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...appData, ...extra }),
    }).then(r => r.json());
    let result = await post();
    if (result.needs_backend_confirm) {
      const confirmed = await _backendConfirmDialog(body, appData.name);
      if (!confirmed) { restore(); return false; }
      result = await post({ install_backend: true });
    }
    if (result.ok) {
      const wasOpen = Array.from(document.querySelectorAll('.window')).some(win => win.dataset.winId === appData.id);
      await mvmOS._refreshPlugins();
      await mvmOS._loadPlugin(appData.id);
      if (wasOpen) Desktop.reloadApp?.(appData.id);
      body._as?.refreshCurrent?.();
      return true;
    }
    restore();
    if (result.min_core_version) {
      alert(t('appstore_requires_core').replace('{min}', result.min_core_version).replace('{cur}', result.current_core_version));
    } else {
      alert('Failed: ' + (result.error || 'unknown'));
    }
    return false;
  }

  function openMvmosApp(id) {
    fetch(`/api/plugins/${id}/open`, { method: 'POST' }).catch(() => {});
    mvmOS._apps?.[id]?.launch?.() ?? mvmOS._loadPlugin(id).then(() => mvmOS._apps?.[id]?.launch?.());
  }

  async function removeMvmosApp(body, app, btn) {
    const appLabel = app.name || app.id;
    const confirmed = app.has_backend
      ? await _backendConfirmDialog(body, appLabel)
      : await mvmOS.confirm(`Remove "${appLabel}"?`, { danger: true });
    if (!confirmed) return false;
    btn.disabled = true; btn.textContent = t('um_removing');
    await fetch(`/api/plugins/${app.id}`, { method: 'DELETE' });
    mvmOS._removeFromStartMenu(app.id);
    window._desktopRemoveApp?.(app.id);
    Desktop.removeApp?.(app.id);
    body._as?.refreshCurrent?.();
    return true;
  }

  // The cards only show what is decided in the list: install, or update when there is
  // one. Everything else about an installed app lives on its own page.
  function renderMvmosApps(list, apps, body, { badge = true } = {}) {
    list.innerHTML = '';
    apps.forEach(app => {
      const row = document.createElement('article');
      row.className = 'as-app-card';
      const actions = [
        app.update_available ? `<button class="s-btn s-btn-sm as-mvmos-update">${t('um_update_btn')}</button>` : '',
        app.installed
          ? (badge ? `<span class="as-installed-badge">${t('appstore_installed_badge')}</span>` : '')
          : `<button class="s-btn s-btn-sm as-mvmos-install">${t('appstore_install')}</button>`,
      ].join('');
      row.innerHTML = `
        <button class="as-app-card-main" type="button" aria-label="${app.name}">
          <span class="as-app-icon">${app.icon || '📦'}</span>
          <span class="as-app-copy"><span class="as-app-name">${app.name}${app.premium ? premiumMark() : ''}${badge ? sourceMark(app) : ''}</span><span class="as-app-desc">${app.description || ''}</span></span>
        </button>
        ${actions ? `<div class="as-app-actions">${actions}</div>` : ''}
      `;

      row.querySelector('.as-app-card-main').addEventListener('click', () => openMvmosAppDetail(body, app));
      row.querySelector('.as-mvmos-install')?.addEventListener('click', async e => {
        e.target.dataset.orig = t('appstore_install');
        await installMvmosApp(body, app, e.target, t('um_installing'));
      });
      row.querySelector('.as-mvmos-update')?.addEventListener('click', async e => {
        e.target.dataset.orig = t('um_update_btn');
        await installMvmosApp(body, app, e.target, t('um_updating'));
      });
      list.appendChild(row);
    });
  }

  async function openMvmosAppDetail(body, app) {
    const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const reviewText = {
      siteLink: t('appstore_reviews_site_link'),
      title: t('appstore_reviews_title'),
      loading: t('appstore_reviews_loading'),
      unavailable: t('appstore_reviews_unavailable'),
      empty: t('appstore_reviews_empty'),
      yourRating: t('appstore_reviews_your_rating'),
      placeholder: t('appstore_reviews_placeholder'),
      save: t('appstore_reviews_save'),
      post: t('appstore_reviews_post'),
      delete: t('appstore_reviews_delete'),
      noOthers: t('appstore_reviews_no_others'),
      choose: t('appstore_reviews_choose'),
      confirmDelete: t('appstore_reviews_confirm_delete'),
    };
    const detail = body.querySelector('#as-detail');
    const detailBody = body.querySelector('#as-detail-body');
    body.querySelector('.as-wrap').classList.add('as-app-detail-open');
    detail.style.display = 'flex';
    detail.classList.add('as-app-detail');
    detailBody.innerHTML = `<div class="as-app-detail-head"><span class="as-app-icon">${app.icon || '📦'}</span><div><div class="as-detail-name">${app.name}</div><div class="as-detail-ver">v${app.version || '—'}</div><div class="as-detail-source"></div></div></div><p class="as-detail-short">${app.description || ''}</p><div class="as-app-detail-actions"></div>${app.premium ? '<section class="as-premium-section"></section>' : ''}<a class="as-site-link" target="_blank" rel="noopener" href="https://mvmos.org/app/${encodeURIComponent(app.id)}">${reviewText.siteLink}</a><section class="as-review-section"><h3>${reviewText.title}</h3><div class="as-review-loading">${reviewText.loading}</div></section>`;
    const reviewsEl = detailBody.querySelector('.as-review-section');
    const premiumEl = detailBody.querySelector('.as-premium-section');
    if (premiumEl) loadPremiumSection(premiumEl, app);

    // Everything you can do with an installed app: open it, its settings, pull the
    // newest version again when something is off, or remove it.
    async function setupActions() {
      const actionsEl = detailBody.querySelector('.as-app-detail-actions');
      const plugins = await fetch('/api/plugins').then(r => r.json()).catch(() => []);
      const inst = Array.isArray(plugins) ? plugins.find(p => p.id === app.id) : null;
      if (!inst || !detailBody.contains(actionsEl)) return;
      const source = inst.is_system ? t('appstore_source_system')
        : inst.store_name ? t('appstore_source', { name: `${inst.official ? '⚡' : '📦'} ${esc(inst.store_name)}` }) : '';
      detailBody.querySelector('.as-detail-source').innerHTML = source;
      const btn = (cls, label, extra = '') => `<button class="s-btn s-btn-sm ${cls}" type="button" ${extra}>${label}</button>`;
      actionsEl.innerHTML = [
        app.update_available ? btn('as-act-update', t('um_update_btn')) : '',
        btn('as-act-open', `▶ ${t('appstore_open')}`),
        inst.settings?.length ? btn('as-act-settings', `⚙ ${t('app_settings')}`) : '',
        inst.is_system ? '' : btn('as-act-reinstall', `↻ ${t('appstore_reinstall')}`, `title="${esc(t('appstore_reinstall_hint'))}"`),
        inst.is_system ? '' : btn('s-btn-danger as-act-remove', t('appstore_remove')),
      ].join('');
      const reopen = extra => openMvmosAppDetail(body, { ...app, ...extra, installed: true });

      actionsEl.querySelector('.as-act-open').addEventListener('click', () => openMvmosApp(app.id));
      actionsEl.querySelector('.as-act-settings')?.addEventListener('click', () => {
        body._as._pendingAppSettings = app.id;
        body.querySelector('.as-tab[data-tab="app-installed"]').click();
      });
      actionsEl.querySelector('.as-act-update')?.addEventListener('click', async e => {
        e.target.dataset.orig = t('um_update_btn');
        if (await installMvmosApp(body, app, e.target, t('um_updating'))) reopen({ update_available: false });
      });
      actionsEl.querySelector('.as-act-reinstall')?.addEventListener('click', async e => {
        const b = e.target;
        b.dataset.orig = `↻ ${t('appstore_reinstall')}`;
        b.disabled = true; b.textContent = t('appstore_reinstalling');
        const res = await fetch(`/api/plugins/${encodeURIComponent(app.id)}/latest`);
        const latest = await res.json().catch(() => ({}));
        if (!res.ok || !latest.id) {
          b.disabled = false; b.textContent = b.dataset.orig;
          alert(t('appstore_reinstall_failed'));
          return;
        }
        if (await installMvmosApp(body, latest, b, t('appstore_reinstalling'))) {
          reopen({ version: latest.version, description: latest.description || app.description, icon: latest.icon || app.icon, update_available: false });
        }
      });
      actionsEl.querySelector('.as-act-remove')?.addEventListener('click', async e => {
        if (await removeMvmosApp(body, { id: app.id, name: app.name, has_backend: inst.has_backend }, e.target)) closeDetail(body);
      });
    }
    if (app.installed) setupActions();

    async function loadReviews() {
      reviewsEl.innerHTML = `<h3>${reviewText.title}</h3><div class="as-review-loading">${reviewText.loading}</div>`;
      const res = await fetch(`/api/plugins/${encodeURIComponent(app.id)}/reviews`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { reviewsEl.innerHTML += `<div class="as-review-error">${reviewText.unavailable}</div>`; return; }
      const mine = (data.reviews || []).find(r => r.mine);
      const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
      const selectedScore = mine?.score || 0;
      reviewsEl.innerHTML = `<h3>${reviewText.title}</h3><div class="as-rating-summary">${data.count ? `<strong>${Number(data.average).toFixed(1)}</strong> <span>${stars(Math.round(data.average))}</span> <small>(${data.count})</small>` : reviewText.empty}</div><form class="as-review-form"><div class="as-review-label">${reviewText.yourRating}</div><div class="as-star-picker" role="radiogroup" aria-label="${reviewText.yourRating}">${[1,2,3,4,5].map(n => `<button class="as-star${n <= selectedScore ? ' is-selected' : ''}" type="button" data-score="${n}" aria-label="${t('appstore_reviews_star', {n})}">★</button>`).join('')}<input name="score" type="hidden" value="${selectedScore}"></div><textarea name="body" maxlength="1000" placeholder="${reviewText.placeholder}">${esc(mine?.body)}</textarea><div><button class="s-btn s-btn-sm" type="submit">${mine ? reviewText.save : reviewText.post}</button>${mine ? `<button class="s-btn s-btn-sm s-btn-danger" type="button" data-delete>${reviewText.delete}</button>` : ''}</div></form><div class="as-review-list">${(data.reviews || []).filter(r => !r.mine).map(r => `<article class="as-review"><b>${esc(r.author)}</b><span>${stars(r.score)}</span>${r.body ? `<p>${esc(r.body)}</p>` : ''}</article>`).join('') || `<div class="as-review-empty">${reviewText.noOthers}</div>`}</div>`;
      const form = reviewsEl.querySelector('form');
      const scoreInput = form.elements.score;
      const starPicker = form.querySelector('.as-star-picker');
      const paintStars = score => {
        form.querySelectorAll('.as-star').forEach(star => star.classList.toggle('is-selected', Number(star.dataset.score) <= score));
      };
      const setScore = score => { scoreInput.value = score; paintStars(score); };
      form.querySelectorAll('.as-star').forEach(star => star.addEventListener('click', () => setScore(Number(star.dataset.score))));
      starPicker.addEventListener('pointerover', event => {
        const star = event.target.closest('.as-star');
        if (star) paintStars(Number(star.dataset.score));
      });
      starPicker.addEventListener('pointerleave', () => paintStars(Number(scoreInput.value)));
      form.onsubmit = async e => { e.preventDefault(); const fd = new FormData(form); const score = Number(fd.get('score')); if (!Number.isInteger(score) || score < 1 || score > 5) { form.querySelector('.as-review-label').textContent = reviewText.choose; return; } const r = await fetch(`/api/plugins/${encodeURIComponent(app.id)}/reviews`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({score, body:fd.get('body')})}); if (r.ok) loadReviews(); };
      reviewsEl.querySelector('[data-delete]')?.addEventListener('click', async () => { if (confirm(reviewText.confirmDelete)) { const r = await fetch(`/api/plugins/${encodeURIComponent(app.id)}/reviews`, {method:'DELETE'}); if (r.ok) loadReviews(); } });
    }
    loadReviews();
  }

  function _backendConfirmDialog(body, appName) {
    return mvmOS.requireRoot(
      t('appstore_backend_title'),
      `"${appName}" ${t('appstore_backend_msg')}<br><span style="color:#f38ba8;font-size:.8rem">${t('appstore_backend_warn')}</span>`
    );
  }

  function _backendRestartDialog() {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:380px;width:90%;box-shadow:var(--shadow)">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">🔄 ${t('backend_restart_title')}</div>
        <div id="as-restart-msg" style="font-size:.85rem;color:var(--text-dim);margin-bottom:20px">${t('backend_restart_msg')}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="as-restart-later" class="s-btn s-btn-sm">${t('backend_restart_later')}</button>
          <button id="as-restart-now" class="s-btn s-btn-sm s-btn-primary">${t('backend_restart_now')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#as-restart-later').addEventListener('click', () => ov.remove());
    ov.querySelector('#as-restart-now').addEventListener('click', async () => {
      const res = await fetch('/api/system/power/restart', { method: 'POST' });
      if (!res.ok) {
        // non-root session can't restart mvmOS — show why instead of failing silently
        ov.querySelector('#as-restart-msg').textContent = t('backend_restart_need_root');
        ov.querySelector('#as-restart-now').style.display = 'none';
        ov.querySelector('#as-restart-later').textContent = t('close');
        return;
      }
      ov.remove();
      window._mvmosShowRestartOverlay?.();
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
    settings.forEach(s => { if (s.default !== undefined) saved[s.key] = s.default; });
    rows.forEach(r => { try { saved[r.key] = JSON.parse(r.value); } catch(_) { saved[r.key] = r.value; } });

    const prev = main.innerHTML;
    const header = body.querySelector('#as-app-installed-list')?.previousElementSibling || null;

    main.innerHTML = `
      <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)">
        <button class="s-btn s-btn-sm" id="as-app-settings-back">${t('as_back')}</button>
        <span style="font-weight:600;font-size:.9rem">${def.icon || ''} ${def.name} — ${t('wstore_settings_title')}</span>
        <span id="as-app-settings-saved" style="font-size:.75rem;color:var(--accent);margin-left:auto;opacity:0;transition:opacity .3s">${t('users_saved')}</span>
      </div>
      <div id="as-app-settings-content" style="padding:14px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;flex:1"></div>
    `;

    const content = main.querySelector('#as-app-settings-content');
    settings.forEach(s => {
      const val = saved[s.key] ?? s.default ?? '';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:4px';
      let input;
      if (s.type === 'select') {
        input = `<select class="s-input" data-key="${s.key}">${(s.options||[]).map(o => { const v = typeof o==='object'?o.value:o; const l = typeof o==='object'?o.label:o; return `<option value="${v}"${val===v?' selected':''}>${l}</option>`; }).join('')}</select>`;
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

    // tray section — auto-added if app has trayable: true
    if (def?.trayable) {
      const trayWrap = document.createElement('div');
      trayWrap.style.cssText = 'border-top:1px solid var(--border);margin-top:8px;padding-top:12px';
      trayWrap.innerHTML = `
        <div style="font-size:.75rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${t('tray_section')}</div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
          <input type="checkbox" data-key="close_to_tray" ${saved.close_to_tray ? 'checked' : ''}>
          ${t('tray_close_to_tray')}
        </label>
        <div style="font-size:.74rem;color:var(--text-dim);margin-top:4px;margin-left:24px">${t('tray_close_to_tray_hint')}</div>
      `;
      content.appendChild(trayWrap);
    }

    const savedIndicator = main.querySelector('#as-app-settings-saved');
    let _saveTimer = null;
    const doSave = async () => {
      for (const s of settings) {
        const el = main.querySelector(`[data-key="${s.key}"]`);
        if (!el) continue;
        const val = s.type === 'checkbox' ? el.checked : (s.type === 'number' ? Number(el.value) : el.value);
        await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [s.key, JSON.stringify(val)]);
      }
      const trayCb = main.querySelector('[data-key="close_to_tray"]');
      if (trayCb) await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['close_to_tray', JSON.stringify(trayCb.checked)]);
      const def3 = mvmOS._apps?.[appId];
      if (typeof def3?.saveSettingsExtra === 'function') await def3.saveSettingsExtra(main);
      window.dispatchEvent(new CustomEvent('settings-changed', { detail: { app: appId } }));
      savedIndicator.style.opacity = '1';
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => { savedIndicator.style.opacity = '0'; }, 1500);
    };

    content.addEventListener('change', doSave);
    content.addEventListener('input', e => {
      if (e.target.matches('input[type="text"], input[type="password"], input[type="number"], textarea')) {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(doSave, 600);
      }
    });

    const goBack = () => { main.innerHTML = prev; if (main.children.length <= 1) loadAppInstalled(body); };
    main.querySelector('#as-app-settings-back').addEventListener('click', goBack);
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
            ${pkg.installed ? `<span class="as-installed-badge">${t('as_installed')}</span>` : ''}
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
      ? `<button class="s-btn s-btn-full s-btn-danger as-remove-btn" data-pkg="${pkgName}">🗑 ${t('appstore_remove')}</button>`
      : `<button class="s-btn s-btn-full as-install-btn" data-pkg="${pkgName}">⬇ ${t('appstore_install')}</button>`;
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
    body.querySelector('.as-wrap').classList.remove('as-app-detail-open');
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

  async function loadWidgetInstalled(body) {
    const list = body.querySelector('#as-widget-installed-list');
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
            ${store.official ? `<span class="as-installed-badge">${t('appstore_official')}</span>` : ''}
          </div>
          <span class="as-pkg-desc" style="font-family:monospace;font-size:.73rem">${store.manifest_url}</span>
        </div>
        ${!store.official ? `<button class="s-btn s-btn-sm s-btn-danger" data-id="${store.id}">${t('appstore_remove')}</button>` : ''}
      `;
      row.querySelector('[data-id]')?.addEventListener('click', async e => {
        if (!confirm(`Remove store "${store.name}"?`)) return;
        await fetch(`/api/widgets/stores/${store.id}`, { method: 'DELETE' });
        loadWidgetStores(body);
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
  }

  function renderWidgetRows(list, widgets, body, { browse = false } = {}) {
    list.innerHTML = '';
    widgets.forEach(w => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div class="as-pkg-info" style="flex:1">
          <div class="as-pkg-top">
            <span class="as-pkg-name">${w.icon} ${w.name}</span>
            ${browse ? sourceMark(w) : ''}
            <span class="as-cat-badge as-cat-sm">${w.category}</span>
            ${w.widget_type ? `<span class="as-cat-badge as-cat-sm" style="background:#89b4fa20;color:#89b4fa">${w.widget_type}</span>` : ''}
            ${w.installed ? `<span class="as-installed-badge">${t('appstore_installed_badge')}</span>` : ''}
            ${w.update_available ? `<span class="as-update-badge">${t('appstore_update')}</span>` : ''}
          </div>
          <span class="as-pkg-desc">${w.description || ''}</span>
          ${!browse && w.installed && w.store_name ? `<span class="as-pkg-ver">${t('appstore_source', { name: `${w.official ? '⚡' : '📦'} ${w.store_name}` })}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-left:10px;flex-shrink:0">
          ${w.update_available ? `<button class="s-btn s-btn-sm ws-update">${t('um_update_btn')}</button>` : ''}
          ${w.installed
            ? `${(window.mvmOS?._widgets?.[w.id]?.settings?.length) ? `<button class="s-btn s-btn-sm ws-settings" data-id="${w.id}">${t('wstore_settings')}</button>` : ''}
               <button class="s-btn s-btn-sm s-btn-danger ws-remove" data-id="${w.id}">${t('remove')}</button>`
            : `<button class="s-btn s-btn-sm ws-install">${t('appstore_install')}</button>`}
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
        doWidgetInstall(w, e.target, t('um_installing'));
      });
      row.querySelector('.ws-update')?.addEventListener('click', e => {
        doWidgetInstall(w, e.target, t('um_updating'));
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
    const prevRefresh = body._as.refreshCurrent;

    // render inside the active panel's list, same as _openAppSettings
    const activePanel = body.querySelector('.as-panel.active');
    const list = activePanel?.querySelector('[id^="as-wstore-list-"], #as-widget-installed-list') || body.querySelector('.as-main');

    // show loading while reading db values
    list.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${t('loading')}</div>`;

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
              ${(s.options || []).map(o => { const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o; return `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`; }).join('')}
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
    list.innerHTML = '';
    list.appendChild(wrap);

    const _goBack = () => {
      body._as.refreshCurrent = prevRefresh;
      prevRefresh?.();
    };

    wrap.querySelector('#ws-settings-back')?.addEventListener('click', _goBack);
    wrap.querySelector('#ws-settings-cancel')?.addEventListener('click', _goBack);
    wrap.querySelector('#ws-settings-save')?.addEventListener('click', async () => {
      const useDb = !!(window.mvmOS?._widgets?.[widgetId]?.useDb);
      const db = useDb ? mvmOS.widgetDb(widgetId) : null;
      if (db) await db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

      async function _save(key, val) {
        if (db) await db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, JSON.stringify(val)]);
        else mvmOS.storage.set(`widget_${widgetId}_${key}`, val);
      }

      for (const s of settings) {
        if (s.type === 'city') {
          const cityEl = wrap.querySelector(`#ws-${widgetId}-${s.key}`);
          const ccEl   = wrap.querySelector(`#ws-${widgetId}-country`);
          if (cityEl) await _save(s.key, cityEl.value.trim());
          if (ccEl)   await _save('country', ccEl.value.trim());
        } else {
          const el = wrap.querySelector(`#ws-${widgetId}-${s.key}`);
          if (!el) continue;
          const val = s.type === 'checkbox' ? el.checked : (s.type === 'number' ? parseFloat(el.value) : el.value);
          await _save(s.key, val);
        }
      }
      window.dispatchEvent(new CustomEvent('widget-settings-changed', { detail: { id: widgetId } }));
      body._as.refreshCurrent = prevRefresh;
      prevRefresh?.();
    });
  }

  function renderThemeStoreRows(list, themes, body) {
    list.innerHTML = '';
    themes.forEach(theme => {
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div style="font-size:1.4rem;width:28px;text-align:center;flex-shrink:0">${theme.icon || '🎨'}</div>
        <div class="as-pkg-info">
          <div class="as-pkg-top"><span class="as-pkg-name">${theme.name}</span>${sourceMark(theme)}</div>
          <div class="as-pkg-desc">${theme.description || ''}</div>
          <div class="as-pkg-ver">${theme.version} · ${theme.layout}</div>
        </div>
        <div class="as-pkg-actions">
          ${theme.is_active ? `<span class="as-installed-badge">${t('as_theme_active')}</span>` :
            theme.installed ? `<button class="s-btn s-btn-sm ts-activate">${t('appstore_activate')}</button>
                    <button class="s-btn-sm s-btn-danger ts-remove">✕</button>` :
            `<button class="s-btn ts-install">${t('appstore_install')}</button>`
          }
        </div>
      `;

      row.querySelector('.ts-install')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = t('loading');
        const res = await fetch('/api/themes/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(theme),
        });
        if ((await res.json()).ok) body._as.refreshCurrent?.();
        else { btn.disabled = false; btn.textContent = t('appstore_install'); }
      });

      row.querySelector('.ts-activate')?.addEventListener('click', async () => {
        await mvmOS._applyTheme(theme.id);
        body._as.refreshCurrent?.();
      });

      row.querySelector('.ts-remove')?.addEventListener('click', async e => {
        e.target.disabled = true;
        await fetch(`/api/themes/${theme.id}`, { method: 'DELETE' });
        body._as.refreshCurrent?.();
      });

      list.appendChild(row);
    });
  }

  function _renderThemeRows(list, themes, onRefresh, stores = []) {
    list.innerHTML = '';
    themes.forEach(th => {
      const store = stores.find(s => s.id === th.store_id);
      const source = store ? ` · ${t('appstore_source', { name: `${store.official ? '⚡' : '📦'} ${store.name}` })}` : '';
      const row = document.createElement('div');
      row.className = 'as-pkg-row';
      row.innerHTML = `
        <div style="font-size:1.4rem;width:28px;text-align:center;flex-shrink:0">${th.icon}</div>
        <div class="as-pkg-info">
          <div class="as-pkg-top"><span class="as-pkg-name">${th.name}</span></div>
          <div class="as-pkg-desc">${th.description}</div>
          <div class="as-pkg-ver">${th.version} · ${th.category}${source}</div>
        </div>
        <div class="as-pkg-actions">
          ${th.is_active
            ? '<span class="as-installed-badge">✓ Active</span>'
            : `<button class="s-btn s-btn-sm ts-activate" data-id="${th.id}">Activate</button>
               ${th.id !== 'default' ? `<button class="s-btn-sm s-btn-danger ts-remove" data-id="${th.id}">✕</button>` : ''}`
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
    const [themesRes, storesRes] = await Promise.all([fetch('/api/themes'), fetch('/api/themes/stores')]);
    const themes = await themesRes.json();
    const stores = await storesRes.json().catch(() => []);
    if (!themes.length) { list.innerHTML = `<div class="as-loading">${t('tstore_no_installed')}</div>`; return; }
    _renderThemeRows(list, themes, () => loadThemeInstalled(body), stores);
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
          ${s.official ? `<span class="as-installed-badge">${t('appstore_official')}</span>` :
            `<button class="s-btn-sm s-btn-danger ts-del-store" data-id="${s.id}">✕ ${t('appstore_remove')}</button>`}
        </div>
      `;
      row.querySelector('.ts-del-store')?.addEventListener('click', async e => {
        await fetch(`/api/themes/stores/${e.target.dataset.id}`, { method: 'DELETE' });
        loadThemeStores(body);
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
    } else {
      const d = await res.json();
      err.textContent = d.detail || t('as_error');
    }
  }

  // render() is exported because the setup wizard hosts the store inside its
  // own step rather than in a Desktop window. It takes any element, so the
  // wizard gets the real store instead of a second implementation of it.
  return { openWindow, render };
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
            ${!u.compatible && u.min_core_version ? `<div style="font-size:.7rem;color:#ffb86c;margin-top:2px">⚠ ${t('um_incompatible')}</div>` : ''}
          </div>
          <div class="as-pkg-actions">
            ${u.compatible !== false
              ? `<button class="s-btn s-btn-sm um-update-btn">${t('um_update_btn')}</button>`
              : `<span style="font-size:.72rem;color:#ffb86c" title="${t('appstore_requires_core').replace('{min}', u.min_core_version).replace('{cur}', '')}">⚠ ${t('um_incompatible')}</span>`}
          </div>
        `;
        if (u.compatible !== false) row.querySelector('.um-update-btn').addEventListener('click', async e => {
          const btn = e.target; btn.disabled = true; btn.textContent = t('um_updating');
          if (!await doMvmOSUpdate(u)) { btn.disabled = false; btn.textContent = t('um_update_btn'); return; }
          mvmosUpdates = mvmosUpdates.filter(x => !(x.id === u.id && x.type === u.type));
          row.remove();
          renderMvmOS();
        });
        mvmosList.appendChild(row);
      });
    }

    mvmosAllBtn.addEventListener('click', async () => {
      mvmosAllBtn.disabled = true; mvmosAllBtn.textContent = t('um_updating');
      const batch = { backendConfirmed: false, cancelled: false };
      try {
        for (const u of [...mvmosUpdates]) {
          if (u.compatible === false) continue;
          const row = mvmosList.querySelector(`[data-uid="${u.id}_${u.type}"]`);
          const btn = row?.querySelector('.um-update-btn');
          if (btn) btn.disabled = true;
          if (await doMvmOSUpdate(u, batch)) {
            mvmosUpdates = mvmosUpdates.filter(x => !(x.id === u.id && x.type === u.type));
            row?.remove();
          }
          if (batch.cancelled) break;
        }
      } finally {
        mvmosAllBtn.disabled = false;
        mvmosAllBtn.textContent = t('um_update_all');
      }
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

  async function doMvmOSUpdate(u, batch = null) {
    const install = async (url, payload) => {
      const res = await fetch(url, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || result.detail || t('um_update_failed'));
      return result;
    };
    try {
      if (u.type === 'app') {
        const payload = { id: u.id, name: u.name, icon: u.icon, category: u.category,
          version: u.new_version, description: u.description, zip_url: u.zip_url || '',
          base_url: u.base_url, js_url: u.js_url, store_id: u.store_id };
        const result = await install('/api/plugins/install', payload);
        if (result.needs_backend_confirm) {
          if (!batch?.backendConfirmed) {
            const confirmed = await mvmOS.requireRoot(t('appstore_backend_title'),
              batch ? t('um_backend_batch_confirm') : `"${u.name}" ${t('appstore_backend_msg')}`);
            if (!confirmed) { if (batch) batch.cancelled = true; return false; }
            if (batch) batch.backendConfirmed = true;
          }
          const updated = await install('/api/plugins/install', { ...payload, install_backend: true });
          if (updated.needs_backend_confirm) throw new Error(t('um_update_failed'));
        }
      } else if (u.type === 'widget') {
        await install('/api/widgets/install', { id: u.id, name: u.name, icon: u.icon, version: u.new_version,
          description: u.description, widget_type: u.widget_type, base_url: u.base_url,
          js_url: u.js_url, store_id: u.store_id });
      } else if (u.type === 'theme') {
        await install('/api/themes/install', { id: u.id, name: u.name, icon: u.icon, version: u.new_version,
          description: u.description, base_url: u.base_url, store_id: u.store_id });
      }
      return true;
    } catch (error) {
      window.alert(`${u.name}: ${error.message}`);
      return false;
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
