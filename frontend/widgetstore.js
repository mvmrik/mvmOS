// ── Widget Store ──────────────────────────────────────────────────────────────

const WidgetStore = (() => {

  function openWindow(filterType) {
    const existing = document.querySelector('.window[data-win-id="widgetstore"]');
    if (existing) { Desktop.focusWindow('widgetstore'); return; }
    Desktop.createWindow({
      id: 'widgetstore',
      title: '🔲 Widget Store',
      width: 700,
      height: 500,
      onMount(body) { render(body, filterType); },
    });
  }

  function render(body, filterType) {
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="as-wrap">
        <nav class="as-sidebar">
          <div class="as-sidebar-group-label">Widget Stores</div>
          <div id="ws-store-tabs"></div>
          <div class="as-sidebar-sep"></div>
          <div class="as-tab" data-tab="installed">✅ Installed</div>
          <div class="as-sidebar-sep"></div>
          <div class="as-tab" data-tab="stores">🔗 Stores</div>
        </nav>
        <div class="as-main">

          <!-- Installed widgets -->
          <div class="as-panel" id="wsp-installed">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Installed widgets</span>
              <button class="s-btn" id="ws-installed-refresh">↺</button>
            </div>
            <div class="as-list" id="ws-installed-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Stores management -->
          <div class="as-panel" id="wsp-stores">
            <div class="as-toolbar">
              <span style="font-size:.8rem;color:var(--text-dim);flex:1">Widget store sources</span>
              <button class="s-btn" id="ws-stores-add-btn">+ Add store</button>
            </div>
            <div id="ws-add-store-form" style="display:none;flex-direction:column;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border)">
              <input class="as-filter" id="ws-store-name" placeholder="Store name">
              <input class="as-filter" id="ws-store-url" placeholder="manifest.json URL">
              <div style="display:flex;gap:6px">
                <button class="s-btn" id="ws-store-submit">Add</button>
                <button class="s-btn-sm" id="ws-store-cancel">Cancel</button>
                <span id="ws-store-err" style="font-size:.78rem;color:#f38ba8;align-self:center"></span>
              </div>
            </div>
            <div class="as-list" id="ws-stores-list"><div class="as-loading">Loading…</div></div>
          </div>

          <!-- Dynamic store panels -->
        </div>
      </div>
    `;

    let _refreshCurrent = null;

    // ── Tab switching ──
    function activateTab(tabEl) {
      body.querySelectorAll('.as-tab').forEach(t => t.classList.remove('active'));
      body.querySelectorAll('.as-panel').forEach(p => p.classList.remove('active'));
      tabEl.classList.add('active');
      const panel = body.querySelector(`#wsp-${tabEl.dataset.tab}`);
      if (panel) panel.classList.add('active');
    }

    body.querySelectorAll('.as-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activateTab(tab);
        if (tab.dataset.tab === 'installed') { loadInstalled(body); _refreshCurrent = () => loadInstalled(body); }
        if (tab.dataset.tab === 'stores') loadStores(body);
      });
    });

    // ── Stores add ──
    body.querySelector('#ws-stores-add-btn').addEventListener('click', () => {
      const f = body.querySelector('#ws-add-store-form');
      f.style.display = f.style.display === 'none' ? 'flex' : 'none';
    });
    body.querySelector('#ws-store-cancel').addEventListener('click', () => {
      body.querySelector('#ws-add-store-form').style.display = 'none';
    });
    body.querySelector('#ws-store-submit').addEventListener('click', () => submitAddStore(body));
    body.querySelector('#ws-installed-refresh').addEventListener('click', () => loadInstalled(body));

    body._ws = { activateTab, get refreshCurrent() { return _refreshCurrent; }, set refreshCurrent(fn) { _refreshCurrent = fn; } };

    loadStoreTabs(body, filterType);
  }

  // ── Store tabs ────────────────────────────────────────────────────────────
  async function loadStoreTabs(body, filterType) {
    const res = await fetch('/api/widgets/stores');
    const stores = await res.json();
    const tabsEl = body.querySelector('#ws-store-tabs');
    tabsEl.innerHTML = '';

    stores.forEach(store => {
      const tab = document.createElement('div');
      tab.className = 'as-tab';
      tab.dataset.tab = `wstore-${store.id}`;
      tab.textContent = store.official ? `⚡ ${store.name}` : `📦 ${store.name}`;
      tabsEl.appendChild(tab);

      const panelId = `wsp-wstore-${store.id}`;
      if (!body.querySelector(`#${panelId}`)) {
        const panel = document.createElement('div');
        panel.className = 'as-panel';
        panel.id = panelId;
        panel.innerHTML = `<div class="as-list" id="ws-store-list-${store.id}"><div class="as-loading">Loading…</div></div>`;
        body.querySelector('.as-main').appendChild(panel);
      }

      tab.addEventListener('click', () => {
        body._ws.activateTab(tab);
        loadStoreCategories(body, store, filterType);
        body._ws.refreshCurrent = () => loadStoreCategories(body, store, filterType);
      });
    });

    if (stores.length) {
      const firstTab = tabsEl.querySelector('.as-tab');
      if (firstTab) body._ws.activateTab(firstTab);
      loadStoreCategories(body, stores[0], filterType);
      body._ws.refreshCurrent = () => loadStoreCategories(body, stores[0], filterType);
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────
  async function loadStoreCategories(body, store, filterType) {
    const list = body.querySelector(`#ws-store-list-${store.id}`);
    if (!list) return;
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const params = filterType ? `store_id=${store.id}&widget_type=${filterType}` : `store_id=${store.id}`;
    const res = await fetch(`/api/widgets/categories?${params}`);
    const data = await res.json();
    if (data.error) { list.innerHTML = `<div class="as-loading">Error: ${data.error}</div>`; return; }

    const cats = data.categories || [];
    if (!cats.length) { list.innerHTML = '<div class="as-loading">No widgets available.</div>'; return; }

    list.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:4px 0';
    cats.forEach(cat => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px 12px;cursor:pointer;text-align:center;transition:background .15s';
      card.innerHTML = `
        <div style="font-size:1.6rem;margin-bottom:6px">${cat.icon || '🔲'}</div>
        <div style="font-weight:600;color:var(--text);font-size:.83rem">${cat.name}</div>
        <div style="color:var(--text-dim);font-size:.75rem;margin-top:2px">${cat.count || ''} widgets</div>
        ${cat.widget_type ? `<div style="font-size:.7rem;color:var(--accent);margin-top:4px">${cat.widget_type}</div>` : ''}
      `;
      card.addEventListener('mouseenter', () => card.style.background = 'var(--surface)');
      card.addEventListener('mouseleave', () => card.style.background = 'var(--surface2)');
      card.addEventListener('click', () => loadCategoryWidgets(body, store, cat, list));
      grid.appendChild(card);
    });
    list.appendChild(grid);
  }

  // ── Category widgets ──────────────────────────────────────────────────────
  async function loadCategoryWidgets(body, store, cat, list) {
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const params = cat.manifest_url
      ? `category_url=${encodeURIComponent(cat.manifest_url)}`
      : `store_id=${store.id}&category_id=${encodeURIComponent(cat.id)}`;
    const res = await fetch(`/api/widgets/category-widgets?${params}`);
    const widgets = await res.json();
    if (widgets.error) { list.innerHTML = `<div class="as-loading">Error: ${widgets.error}</div>`; return; }

    const backBar = document.createElement('div');
    backBar.className = 'as-toolbar';
    backBar.innerHTML = `<button class="s-btn s-btn-sm">← ${cat.name}</button>`;
    backBar.querySelector('button').addEventListener('click', () => loadStoreCategories(body, store));
    list.innerHTML = '';
    list.appendChild(backBar);

    const el = document.createElement('div');
    list.appendChild(el);
    renderWidgets(el, widgets.map(w => ({ ...w, official: store.official ?? 0, store_id: store.id })), body);
    body._ws.refreshCurrent = () => loadCategoryWidgets(body, store, cat, list);
  }

  // ── Installed ─────────────────────────────────────────────────────────────
  async function loadInstalled(body) {
    const list = body.querySelector('#ws-installed-list');
    list.innerHTML = '<div class="as-loading">Loading…</div>';
    const res = await fetch('/api/widgets');
    const widgets = await res.json();
    if (!widgets.length) { list.innerHTML = '<div class="as-loading">No widgets installed.</div>'; return; }
    renderWidgets(list, widgets.map(w => ({ ...w, installed: true })), body);
  }

  // ── Stores management ─────────────────────────────────────────────────────
  async function loadStores(body) {
    const list = body.querySelector('#ws-stores-list');
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
        loadStores(body);
        loadStoreTabs(body);
      });
      list.appendChild(row);
    });
  }

  async function submitAddStore(body) {
    const name = body.querySelector('#ws-store-name').value.trim();
    const url  = body.querySelector('#ws-store-url').value.trim();
    const err  = body.querySelector('#ws-store-err');
    if (!name || !url) { err.textContent = 'Name and URL required.'; return; }
    err.textContent = 'Checking…';
    const res = await fetch('/api/widgets/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, manifest_url: url }),
    });
    const data = await res.json();
    if (data.error) { err.textContent = data.error; return; }
    body.querySelector('#ws-store-name').value = '';
    body.querySelector('#ws-store-url').value = '';
    body.querySelector('#ws-add-store-form').style.display = 'none';
    err.textContent = '';
    loadStores(body);
    loadStoreTabs(body);
  }

  // ── Widget row renderer ───────────────────────────────────────────────────
  function renderWidgets(list, widgets, body) {
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
          ${w.installed
            ? `<button class="s-btn s-btn-sm s-btn-danger ws-remove" data-id="${w.id}">Remove</button>`
            : `<button class="s-btn s-btn-sm ws-install" data-widget='${JSON.stringify(w)}'>Install</button>`}
        </div>
      `;

      row.querySelector('.ws-install')?.addEventListener('click', async e => {
        const btn = e.target;
        const data = JSON.parse(btn.dataset.widget);
        if (!data.official) {
          if (!confirm(`⚠️ Third-party widget\n\n"${data.name}" is from an unofficial store. Install anyway?`)) return;
        }
        btn.disabled = true; btn.textContent = 'Installing…';
        const res = await fetch('/api/widgets/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.ok) {
          await mvmOS._loadWidget(data.id);
          body._ws.refreshCurrent?.();
        } else {
          btn.disabled = false; btn.textContent = 'Install';
          alert('Failed: ' + (result.error || 'unknown'));
        }
      });

      row.querySelector('.ws-remove')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Removing…';
        await fetch(`/api/widgets/${btn.dataset.id}`, { method: 'DELETE' });
        mvmOS._removeWidget(btn.dataset.id);
        body._ws.refreshCurrent?.();
      });

      list.appendChild(row);
    });
  }

  return { openWindow };
})();
