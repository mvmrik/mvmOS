const AppHub = (() => {
  // ── Helpers ────────────────────────────────────────────────────
  function renderAvatar(u, size) {
    if (u && u.avatar_svg) {
      return u.avatar_svg
        .replace(/width="\d+"/, `width="${size}"`)
        .replace(/height="\d+"/, `height="${size}"`);
    }
    const color  = String(u?.avatar_color || '#585b70').replace(/</g,'');
    const letter = String((u?.display_name?.[0] || '?').toUpperCase()).replace(/</g,'');
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.45)}px;color:#1e1e2e;flex-shrink:0">${letter}</div>`;
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  // ── Public API for other apps ──────────────────────────────────

  function getToken() { return localStorage.getItem('apphub_token') || null; }

  async function getUser() {
    const t = getToken();
    if (!t) return null;
    try {
      const r = await fetch('/api/pub/apphub/me', {headers:{'X-Pub-Token':t}});
      if (r.ok) return await r.json();
      localStorage.removeItem('apphub_token');
    } catch(_) {}
    return null;
  }

  // ── Signed-in profile in the Start menu ─────────────────────────
  // The Apps Hub sign-in belongs to the browser, so the Start menu shows it
  // under the Linux user whenever there is one — that is the profile new
  // Clipboard items and other Apps Hub features act as.
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  let _menuUser = null, _menuToken = null, _menuAt = 0;

  async function paintMenuProfile(force) {
    const row = document.getElementById('start-hub-user');
    if (!row) return;
    const token = getToken();
    if (!token) { _menuUser = null; _menuToken = null; row.style.display = 'none'; return; }
    if (force || _menuToken !== token || !_menuUser || Date.now() - _menuAt > 30000) {
      _menuUser = await getUser();
      _menuToken = _menuUser ? token : null;
      _menuAt = Date.now();
    }
    if (!_menuUser) { row.style.display = 'none'; return; }
    row.innerHTML = `${renderAvatar(_menuUser, 24)}<div class="start-hub-names"><span>${esc(_menuUser.display_name || _menuUser.username)}</span><span class="start-hub-sub">@${esc(_menuUser.username)} · ${esc(_t('app_apphub'))}</span></div>`;
    row.title = _t('app_apphub');
    row.style.display = '';
  }

  (function initMenuProfile() {
    const row = document.getElementById('start-hub-user');
    if (!row) return;
    row.addEventListener('click', () => {
      document.getElementById('start-menu')?.classList.remove('open');
      openWindow('account');
    });
    const refresh = () => paintMenuProfile(false);
    window.addEventListener('apphub_login', () => paintMenuProfile(true));
    window.addEventListener('apphub_logout', () => paintMenuProfile(true));
    window.addEventListener('storage', e => { if (e.key === 'apphub_token') paintMenuProfile(true); });
    window.addEventListener('focus', refresh);
    window.addEventListener('i18n-loaded', () => paintMenuProfile(false));
    const menu = document.getElementById('start-menu');
    if (menu) new MutationObserver(() => { if (menu.classList.contains('open')) refresh(); })
      .observe(menu, { attributes: true, attributeFilter: ['class'] });
    refresh();
  })();

  /**
   * Call this from any app to ensure the user is logged into Apps Hub.
   * If already logged in, calls cb(user) immediately.
   * If not, opens the Apps Hub window on the login tab and calls cb(user) when done.
   */
  function requireLogin(cb) {
    const t = getToken();
    if (t) {
      fetch('/api/pub/apphub/me', {headers:{'X-Pub-Token':t}})
        .then(r => r.ok ? r.json() : null)
        .then(u => {
          if (u) { cb(u); return; }
          localStorage.removeItem('apphub_token');
          _openForLogin(cb);
        })
        .catch(() => _openForLogin(cb));
    } else {
      _openForLogin(cb);
    }
  }

  let _pendingCancel = null;

  function _openForLogin(cb) {
    if (_pendingCancel) _pendingCancel();
    openWindow('account');
    let _done = false;
    const finish = (token, user) => {
      if (_done) return;
      _done = true;
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('apphub_login', loginHandler);
      if (_pendingCancel === cancel) _pendingCancel = null;
      if (user) { cb(user); return; }
      fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': token } })
        .then(r => r.ok ? r.json() : null)
        .then(u => { if (u) cb(u); });
    };
    const storageHandler = e => {
      if (e.key === 'apphub_token' && e.newValue) finish(e.newValue, null);
    };
    const loginHandler = e => finish(e.detail.token, e.detail.user);
    const cancel = () => {
      _done = true;
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('apphub_login', loginHandler);
    };
    window.addEventListener('storage', storageHandler);
    window.addEventListener('apphub_login', loginHandler);
    _pendingCancel = cancel;
  }

  // ── Window ─────────────────────────────────────────────────────

  function openWindow(startTab) {
    Desktop.createWindow({
      id:     'apphub',
      title:  '🧩 Apps Hub',
      width:  560,
      height: 600,
      onMount(body) {
        body.style.cssText = 'padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden';
        _mount(body, startTab || 'account');
      },
    });
  }

  function _mount(body, startTab) {
    let _pubUser  = null;
    let _activeTab = startTab;

    const t = window.t || (k => k);
    const tabs = [
      { id: 'account',    label: t('ah_tab_account') },
      { id: 'favourites', label: t('ah_tab_favourites') },
      { id: 'apps',       label: t('ah_tab_apps'), adminOnly: true },
      { id: 'paid',       label: t('ah_tab_paid_apps'), adminOnly: true },
      { id: 'app-apis',   label: t('ah_tab_app_apis'), adminOnly: true },
      { id: 'keys',       label: t('ah_tab_keys'), adminOnly: true },
      { id: 'users',      label: t('ah_tab_users'), adminOnly: true },
    ];

    // Main categories on top, the tabs of the chosen category below them.
    const groups = [
      { id: 'profile', label: t('ah_group_profile'), tabs: ['account', 'favourites'] },
      { id: 'apps',    label: t('ah_group_apps'),    tabs: ['apps', 'paid', 'app-apis', 'keys'] },
      { id: 'users',   label: t('ah_group_users'),   tabs: ['users'] },
    ];
    const groupOf = id => groups.find(g => g.tabs.includes(id)) || groups[0];
    const tabBtn = (id, label, cls, pad) => `<button class="${cls}" data-t="${id}"
      style="background:none;border:none;border-bottom:2px solid transparent;padding:${pad};font-size:.85rem;color:var(--text-dim);cursor:pointer;font-family:inherit;white-space:nowrap">${label}</button>`;

    body.innerHTML = `
      <div style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;scrollbar-width:thin">
        ${groups.map(g => tabBtn(g.id, g.label, 'ah-group', '10px 16px').replace('font-size:.85rem', 'font-size:.9rem;font-weight:600')).join('')}
      </div>
      <div id="ah-sub" style="display:none;border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;scrollbar-width:thin;background:var(--surface2)"></div>
      <div id="ah-body" style="flex:1;overflow-y:auto"></div>`;

    function setTab(id) {
      _activeTab = id;
      const g = groupOf(id);
      body.querySelectorAll('.ah-group').forEach(b => {
        const active = b.dataset.t === g.id;
        b.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
        b.style.borderColor = active ? 'var(--accent)' : 'transparent';
      });
      const sub = body.querySelector('#ah-sub');
      sub.style.display = g.tabs.length > 1 ? 'flex' : 'none';
      sub.innerHTML = g.tabs.length > 1 ? g.tabs.map(tid => tabBtn(tid, tabs.find(x => x.id === tid).label, 'ah-tab', '8px 14px')).join('') : '';
      sub.querySelectorAll('.ah-tab').forEach(b => {
        const active = b.dataset.t === id;
        b.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
        b.style.borderColor = active ? 'var(--accent)' : 'transparent';
        b.onclick = () => setTab(b.dataset.t);
      });
      const c = body.querySelector('#ah-body');
      if (id === 'account') renderAccount(c);
      else if (id === 'favourites') renderFavourites(c);
      else if (id === 'apps')  renderApps(c);
      else if (id === 'paid')  renderCreditServices(c);
      else if (id === 'app-apis') renderAppApis(c);
      else if (id === 'keys') renderKeys(c);
      else if (id === 'users') renderUsers(c);
    }

    body.querySelectorAll('.ah-group').forEach(b => {
      b.onclick = () => {
        const g = groups.find(x => x.id === b.dataset.t);
        setTab(g.tabs.includes(_activeTab) ? _activeTab : g.tabs[0]);
      };
    });

    // ── Account tab ────────────────────────────────────────────
    async function renderAccount(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      _pubUser = await getUser();
      if (!_pubUser) {
        _renderLogin(c);
      } else {
        _renderProfile(c);
      }
    }

    async function _renderLogin(c) {
      let regAllowed = true;
      try {
        const rr = await fetch('/api/pub/apphub/registration');
        if (rr.ok) regAllowed = !!(await rr.json()).allowed;
      } catch (_) {}

      c.innerHTML = `
        <div style="padding:20px;display:flex;flex-direction:column;gap:16px;max-width:340px">
          <div style="font-weight:600;font-size:.95rem">${t('ah_signin_title')}</div>
          ${regAllowed ? `<div style="display:flex;gap:0;background:var(--surface2);border-radius:8px;padding:3px">
            <button id="ah-tab-login" style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:var(--on-accent,#fff);font-weight:600">${t('ah_login')}</button>
            <button id="ah-tab-reg"   style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)">${t('ah_register')}</button>
          </div>` : ''}
          <div id="ah-login-form"></div>
          <div id="ah-reg-form" style="display:none;flex-direction:column;gap:10px"></div>
        </div>`;

      const loginForm = c.querySelector('#ah-login-form');
      const regForm   = c.querySelector('#ah-reg-form');

      function showLogin() {
        const tl = c.querySelector('#ah-tab-login'), tr = c.querySelector('#ah-tab-reg');
        if (tl) tl.style.cssText = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:var(--on-accent,#fff);font-weight:600';
        if (tr) tr.style.cssText = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)';
        loginForm.style.display = '';
        regForm.style.display   = 'none';
        loginForm.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px">
            <input class="s-inp" id="ah-un" placeholder="${t('ah_username_ph')}" autocomplete="username">
            <input class="s-inp" id="ah-pw" type="password" placeholder="${t('ah_password_ph')}" autocomplete="current-password">
            <div class="s-err" id="ah-err" style="color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.82rem;min-height:16px"></div>
            <button class="s-btn" id="ah-login-btn" style="background:var(--accent);color:var(--on-accent,#fff);font-weight:600">${t('ah_login')}</button>
          </div>`;
        const btn = loginForm.querySelector('#ah-login-btn');
        const err = loginForm.querySelector('#ah-err');
        btn.onclick = async () => {
          const un = loginForm.querySelector('#ah-un').value.trim();
          const pw = loginForm.querySelector('#ah-pw').value;
          if (!un || !pw) { err.textContent = t('ah_fill_all_fields'); return; }
          btn.disabled = true; err.textContent = '';
          const r = await fetch('/api/pub/apphub/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username: un, password: pw}),
          }).catch(()=>null);
          if (r?.ok) {
            const d = await r.json();
            localStorage.setItem('apphub_token', d.token);
            window.dispatchEvent(new CustomEvent('apphub_login', { detail: { token: d.token, user: d.user } }));
            _pubUser = d.user;
            _renderProfile(c);
          } else {
            const d = r ? await r.json().catch(()=>({})) : {};
            err.textContent = d.detail || t('ah_login_failed');
            btn.disabled = false;
          }
        };
        loginForm.querySelector('#ah-pw').onkeydown = e => { if (e.key==='Enter') btn.click(); };
      }

      function showReg() {
        c.querySelector('#ah-tab-login').style.cssText = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)';
        c.querySelector('#ah-tab-reg').style.cssText   = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:var(--on-accent,#fff);font-weight:600';
        loginForm.style.display = 'none';
        regForm.style.display   = 'flex';
        regForm.innerHTML = `
          <input class="s-inp" id="ah-r-dn" placeholder="${t('ah_display_name_ph')}">
          <input class="s-inp" id="ah-r-un" placeholder="${t('ah_username_ph')}" autocomplete="username">
          <input class="s-inp" id="ah-r-pw" type="password" placeholder="${t('ah_password_min_ph')}" autocomplete="new-password">
          <div style="color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.82rem;min-height:16px" id="ah-r-err"></div>
          <button class="s-btn" id="ah-reg-btn" style="background:var(--accent);color:var(--on-accent,#fff);font-weight:600">${t('ah_create_account')}</button>`;
        const btn = regForm.querySelector('#ah-reg-btn');
        const err = regForm.querySelector('#ah-r-err');
        btn.onclick = async () => {
          const dn = regForm.querySelector('#ah-r-dn').value.trim();
          const un = regForm.querySelector('#ah-r-un').value.trim();
          const pw = regForm.querySelector('#ah-r-pw').value;
          if (!dn||!un||!pw) { err.textContent = t('ah_fill_all_fields'); return; }
          btn.disabled = true; err.textContent = '';
          const r = await fetch('/api/pub/apphub/register', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({display_name: dn, username: un, password: pw, avatar_color: '#89b4fa'}),
          }).catch(()=>null);
          if (r?.ok) {
            const d = await r.json();
            localStorage.setItem('apphub_token', d.token);
            window.dispatchEvent(new CustomEvent('apphub_login', { detail: { token: d.token, user: d.user } }));
            _pubUser = d.user;
            _renderProfile(c);
          } else {
            const d = r ? await r.json().catch(()=>({})) : {};
            err.textContent = d.detail || t('ah_registration_failed');
            btn.disabled = false;
          }
        };
      }

      const tlBtn = c.querySelector('#ah-tab-login'), trBtn = c.querySelector('#ah-tab-reg');
      if (tlBtn) tlBtn.onclick = showLogin;
      if (trBtn) trBtn.onclick = showReg;
      showLogin();
    }

    function _renderProfile(c) {
      const u = _pubUser;
      c.innerHTML = `
        <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;align-items:center;gap:14px">
            ${renderAvatar(u, 54)}
            <div>
              <div style="font-weight:700;font-size:1.05rem">${esc(u.display_name)}</div>
              <div style="font-size:.82rem;color:var(--text-dim)">@${esc(u.username)}</div>
            </div>
            <div style="margin-left:auto;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <a href="/pub/apphub/?token=${getToken()}&tab=profile" target="_blank"
                 style="font-size:.78rem;color:var(--accent);text-decoration:none;border:1px solid var(--accent);border-radius:6px;padding:4px 10px">
                ${t('ah_edit_profile')}
              </a>
              <button id="ah-logout" style="border:none;background:none;color:var(--text-dim);font-size:.78rem;cursor:pointer;font-family:inherit;padding:4px 10px;border:1px solid var(--border);border-radius:6px">${t('ah_logout')}</button>
            </div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:.82rem;color:var(--text-dim);line-height:1.6">
            ${t('ah_account_active')}
          </div>
        </div>`;
      c.querySelector('#ah-logout').onclick = async () => {
        await fetch('/api/pub/apphub/logout', {method:'POST',headers:{'X-Pub-Token':getToken()}}).catch(()=>{});
        localStorage.removeItem('apphub_token');
        _pubUser = null;
        window.dispatchEvent(new CustomEvent('apphub_logout'));
        _renderLogin(c);
      };
    }

    // ── Favourites tab ─────────────────────────────────────────
    // Single shared list, also used by Game Hub and Chat — this is
    // where people are searched for and added/removed.
    let _favs = null;

    async function _loadFavs() {
      try {
        const r = await fetch('/api/pub/apphub/favourites', {headers:{'X-Pub-Token':getToken()}});
        _favs = r.ok ? await r.json() : [];
      } catch (_) {
        _favs = [];
      }
    }
    function _isFav(userId) { return !!(_favs && _favs.some(f=>f.id===userId)); }
    async function _toggleFav(p) {
      const isFav = _isFav(p.id);
      await fetch(`/api/pub/apphub/favourites/${p.id}`, {method: isFav ? 'DELETE' : 'POST', headers:{'X-Pub-Token':getToken()}}).catch(()=>{});
      if (isFav) { _favs = (_favs||[]).filter(f=>f.id!==p.id); }
      else { _favs = [p, ...(_favs||[]).filter(f=>f.id!==p.id)]; }
    }

    function _favRow(p, onFavChange) {
      const fav = _isFav(p.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;justify-content:space-between;padding:8px 0';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${renderAvatar(p, 32)}
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.display_name||p.username||'?')}</div>
            ${p.username?`<div style="font-size:11px;color:var(--text-dim)">@${esc(p.username)}</div>`:''}
          </div>
        </div>
        <button class="s-btn-sm" style="padding:5px 10px;font-size:12px;flex-shrink:0;cursor:pointer">${fav?t('ah_favourited'):t('ah_favourite')}</button>`;
      row.querySelector('button').onclick = async () => {
        await _toggleFav(p);
        if (onFavChange) onFavChange();
      };
      return row;
    }

    async function renderFavourites(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      if (!_pubUser) _pubUser = await getUser();
      if (!_pubUser) { _renderLogin(c); return; }

      if (_favs === null) await _loadFavs();

      c.innerHTML = `
        <div style="padding:16px;display:flex;flex-direction:column;gap:14px;max-width:480px">
          <div>
            <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);margin-bottom:8px">${t('ah_find_people')}</div>
            <input class="s-inp" id="fav-search" placeholder="${t('ah_search_people_ph')}" autocomplete="off" style="width:100%">
            <div id="fav-results" style="display:flex;flex-direction:column;margin-top:8px"></div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:14px">
            <div style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);margin-bottom:8px">${t('ah_saved_favourites')}</div>
            <div id="fav-saved" style="display:flex;flex-direction:column"></div>
          </div>
        </div>`;

      const resultsEl = c.querySelector('#fav-results');
      const savedEl   = c.querySelector('#fav-saved');
      let _searchTimer = null;

      function renderSaved() {
        savedEl.innerHTML = '';
        if (!_favs || !_favs.length) {
          savedEl.innerHTML = `<div style="color:var(--text-dim);font-size:13px">${t('ah_no_favourites')}</div>`;
          return;
        }
        _favs.forEach(f => savedEl.appendChild(_favRow(f, renderSaved)));
      }
      renderSaved();

      async function renderSearch(q) {
        resultsEl.innerHTML = '';
        if (q.length < 2) return;
        resultsEl.innerHTML = `<div style="color:var(--text-dim);font-size:13px">${t('ah_searching')}</div>`;
        const r = await fetch(`/api/pub/apphub/search?q=${encodeURIComponent(q)}`).catch(()=>null);
        const hits = r?.ok ? (await r.json()).filter(p => p.id !== _pubUser?.id) : [];
        resultsEl.innerHTML = '';
        if (!hits.length) {
          resultsEl.innerHTML = `<div style="color:var(--text-dim);font-size:13px">${t('ah_no_people_found')}</div>`;
          return;
        }
        hits.forEach(p => resultsEl.appendChild(_favRow(p, () => { renderSaved(); renderSearch(q); })));
      }

      c.querySelector('#fav-search').oninput = e => {
        clearTimeout(_searchTimer);
        const q = e.target.value.trim();
        _searchTimer = setTimeout(() => renderSearch(q), 300);
      };
    }

    // ── Public Apps tab ────────────────────────────────────────
    async function renderApps(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      const r = await fetch('/api/apphub/public-apps').catch(()=>null);
      if (!r?.ok) { c.innerHTML = `<div style="padding:20px;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.85rem">${t('ah_error_loading_apps')}</div>`; return; }
      const apps = await r.json();
      const features = await fetch('/api/apphub/features').then(r => r.ok ? r.json() : {}).catch(() => ({}));
      if (!apps.length) { c.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('ah_no_public_apps')}</div>`; return; }
      const categoryKey = 'apphub_apps_category';
      const categories = [...new Set(apps.map(a => a.category || 'Utilities'))].sort((a, b) => mvmOS.categoryName(a).localeCompare(mvmOS.categoryName(b)));
      let selectedCategory = localStorage.getItem(categoryKey) || 'all';
      if (selectedCategory !== 'all' && !categories.includes(selectedCategory)) selectedCategory = 'all';

      c.innerHTML = `
        <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
          ${t('ah_public_apps_hint')}
        </div>
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <label for="ah-apps-category" style="font-size:.78rem;color:var(--text-dim)">${t('ah_apps_category')}</label>
          <select id="ah-apps-category" class="s-inp" style="width:auto;padding:5px 8px;font-size:.8rem">
            <option value="all">${t('ah_apps_all_categories')}</option>
            ${categories.map(category => `<option value="${esc(category)}"${category===selectedCategory?' selected':''}>${esc(mvmOS.categoryName(category))}</option>`).join('')}
          </select>
        </div>
        <div id="ah-apps-list"></div>`;

      function render(list) {
        const visibleApps = selectedCategory === 'all' ? apps : apps.filter(a => (a.category || 'Utilities') === selectedCategory);
        list.innerHTML = visibleApps.map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
            <span style="font-size:1.4rem">${mvmOS.iconHTML(a)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.88rem;font-weight:500">${esc(mvmOS.appName(a))}</div>
              ${a.public_name ? `<div style="font-size:.76rem;color:var(--text-dim)">${esc(a.public_name)}</div>` : ''}
              <div style="font-size:.72rem;color:var(--text-dim)">/pub/${esc(a.id)}/</div>
            </div>
            <button class="ah-rename s-btn s-btn-sm" data-app="${esc(a.id)}" style="cursor:pointer">✎ ${t('ah_public_rename')}${features.public_names ? '' : ' 🔒'}</button>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
              <input type="checkbox" data-id="${a.id}" ${a.enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
              <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?t('ah_public'):t('ah_private')}</span>
            </label>
            ${a.enabled ? `<a href="/pub/${a.id}/" target="_blank" style="font-size:.75rem;color:var(--accent);text-decoration:none">↗</a>` : ''}
          </div>
          `).join('');

        list.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.onchange = async () => {
            const id  = cb.dataset.id;
            const app = apps.find(x => x.id === id);
            if (!app) return;
            app.enabled = cb.checked;
            await fetch(`/api/apphub/public-apps/${id}`, {
              method: 'PUT',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({enabled: cb.checked}),
            });
            render(list);
          };
        });
        list.querySelectorAll('.ah-rename').forEach(btn => {
          if (!features.public_names) window.mvmOS?.premiumGate(btn, t('ah_public_rename'));
          btn.onclick = async () => {
          if (!features.public_names) { window.alert(t('ah_action_failed')); return; }
          const app = apps.find(a => a.id === btn.dataset.app);
          const name = await new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(t('ah_public_rename'))}" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:24px;max-width:380px;width:90%;display:flex;flex-direction:column;gap:12px">
              <label for="ah-public-name">${t('ah_public_name_prompt')}</label>
              <input id="ah-public-name" class="s-input" maxlength="80" style="width:100%;box-sizing:border-box">
              <div style="display:flex;gap:8px;justify-content:flex-end"><button class="s-btn" data-cancel>${t('cancel')}</button><button class="s-btn s-btn-primary" data-save>${t('ah_save')}</button></div>
            </div>`;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('input'); input.value = app.public_name || '';
            const finish = value => { overlay.remove(); btn.focus(); resolve(value); };
            overlay.querySelector('[data-cancel]').onclick = () => finish(null);
            overlay.querySelector('[data-save]').onclick = () => finish(input.value);
            input.onkeydown = event => { if (event.key === 'Enter') finish(input.value); if (event.key === 'Escape') finish(null); };
            input.focus(); input.select();
          });
          if (name === null || name === undefined) return;
          if (name.trim().length > 80) { window.alert(t('ah_public_name_invalid')); return; }
          btn.disabled = true;
          const response = await fetch(`/api/apphub/public-apps/${encodeURIComponent(app.id)}/name`, {
            method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name})
          }).catch(() => null);
          btn.disabled = false;
          if (response?.status === 402) { window.mvmOS?.premiumGate(btn, t('ah_public_rename')); return; }
          if (!response?.ok) { window.alert(t('ah_action_failed')); return; }
          app.public_name = name.trim(); render(list);
          };
        });
      }
      c.querySelector('#ah-apps-category').onchange = e => {
        selectedCategory = e.target.value;
        localStorage.setItem(categoryKey, selectedCategory);
        render(c.querySelector('#ah-apps-list'));
      };
      render(c.querySelector('#ah-apps-list'));
    }

    // ── App-to-app API tab ────────────────────────────────────
    async function renderAppApis(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      const r = await fetch('/api/apphub/app-apis').catch(()=>null);
      if (!r?.ok) { c.innerHTML = `<div style="padding:20px;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.85rem">${t('ah_error_loading_apps')}</div>`; return; }
      const apps = await r.json();
      if (!apps.length) { c.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('ah_no_app_apis')}</div>`; return; }

      c.innerHTML = `
        <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
          ${t('ah_app_apis_hint')}
        </div>
        <div id="ah-app-apis-list"></div>`;

      const _fmtParams = params => (params || [])
        .map(p => `${p.name}${p.optional ? '?' : ''}${p.type ? ': ' + p.type : ''}`).join(', ');

      function render(list) {
        list.innerHTML = apps.map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
            <span style="font-size:1.4rem">${mvmOS.iconHTML(a)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.88rem;font-weight:500">${esc(mvmOS.appName(a))}</div>
              <div style="font-size:.72rem;color:var(--text-dim)">${esc(a.id)}/api.py</div>
            </div>
            ${(a.actions || []).length ? `<button class="ah-api-actions-toggle s-btn s-btn-sm" data-app="${esc(a.id)}" aria-expanded="false" style="cursor:pointer;white-space:nowrap">🧩 ${t('ah_app_api_actions_button')} (${a.actions.length})</button>` : ''}
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
              <input type="checkbox" data-id="${a.id}" ${a.enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
              <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?t('ah_enabled'):t('ah_disabled')}</span>
            </label>
          </div>
          ${(a.actions || []).length ? `<div class="ah-api-actions-panel" data-app="${esc(a.id)}" hidden style="border-bottom:1px solid var(--border);background:var(--surface1);padding:12px 16px 12px 48px">
            <div style="font-size:.76rem;color:var(--text-dim);margin-bottom:8px">${t('ah_app_api_actions_hint_short')}</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${a.actions.map(act => `<div style="padding:10px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface2)">
                <div style="font-size:.82rem;font-weight:650;font-family:monospace">${esc(act.name)}(${esc(_fmtParams(act.params))})</div>
                ${act.summary ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:3px">${esc(act.summary)}</div>` : ''}
              </div>`).join('')}
            </div>
          </div>` : ''}`).join('');

        list.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.onchange = async () => {
            const id  = cb.dataset.id;
            const app = apps.find(x => x.id === id);
            if (!app) return;
            app.enabled = cb.checked;
            await fetch(`/api/apphub/app-apis/${id}`, {
              method: 'PUT',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({enabled: cb.checked}),
            });
            render(list);
          };
        });
        list.querySelectorAll('.ah-api-actions-toggle').forEach(btn => btn.onclick = () => {
          const panel = list.querySelector(`.ah-api-actions-panel[data-app="${btn.dataset.app}"]`);
          if (!panel) return;
          panel.hidden = !panel.hidden;
          btn.setAttribute('aria-expanded', String(!panel.hidden));
        });
      }
      render(c.querySelector('#ah-app-apis-list'));
    }

    // ── API keys tab ───────────────────────────────────────────
    // Keys the administrator adds for outside services (Google Maps today).
    // Open a key to see the apps that use its service, pick the apps it is
    // valid for and, per app, the people. People's own keys are not shown here.
    async function renderKeys(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      const r = await fetch('/api/apphub/service-keys').catch(() => null);
      if (!r?.ok) { c.innerHTML = `<div style="padding:20px;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.85rem">${t('ah_error_loading_apps')}</div>`; return; }
      const data = await r.json();
      const J = { 'Content-Type': 'application/json' };
      const call = (method, url, body) => fetch(url, { method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
      const BASE = '/api/apphub/service-keys';
      const err = 'color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9))';
      const inp = 'padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:inherit';
      const svcLabel = id => (data.services.find(x => x.service === id) || {}).label || id;
      const open = new Set();      // opened key cards
      const openApp = new Set();   // opened "key:app" people panels

      function draw() {
        c.innerHTML = `
          <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">${esc(t('ah_keys_hint'))}</div>
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="ak-svc" style="${inp}">${data.services.map(sv => `<option value="${esc(sv.service)}">${esc(sv.label)}</option>`).join('')}</select>
            <input id="ak-name" placeholder="${esc(t('ah_keys_name_ph'))}" style="${inp};width:170px">
            <input id="ak-key" type="password" autocomplete="off" placeholder="${esc(t('keys_placeholder'))}" style="${inp};flex:1;min-width:180px">
            <button id="ak-add" class="s-btn s-btn-sm" style="cursor:pointer">${esc(t('ah_keys_add'))}</button>
            <div id="ak-msg" style="width:100%;font-size:.78rem;min-height:14px;${err}"></div>
            <div id="ak-redirect" style="width:100%;display:none;font-size:.78rem;color:var(--text-dim)">${esc(t('keys_redirect'))}: <input readonly value="${esc(location.origin)}" onfocus="this.select()" style="${inp};min-width:260px"></div>
          </div>
          <div style="padding:8px 16px;font-size:.74rem;color:var(--text-dim)">${esc(t('ah_keys_costs'))} ${esc(t('ah_keys_order'))}</div>
          <div id="ak-list"></div>`;
        const list = c.querySelector('#ak-list');
        list.innerHTML = data.keys.length ? data.keys.map(keyCard).join('') :
          `<div style="padding:16px;font-size:.84rem;color:var(--text-dim)">${esc(t('ah_keys_none_yet'))}</div>`;
        const msg = c.querySelector('#ak-msg');
        const svcSel = c.querySelector('#ak-svc');
        const showRedirect = () => { c.querySelector('#ak-redirect').style.display = (data.services.find(x => x.service === svcSel.value) || {}).redirect ? 'block' : 'none'; };
        svcSel.onchange = showRedirect; showRedirect();
        c.querySelector('#ak-add').onclick = async () => {
          const res = await call('POST', BASE, { service: c.querySelector('#ak-svc').value,
            name: c.querySelector('#ak-name').value, key: c.querySelector('#ak-key').value });
          if (res?.ok) { const k = await res.json(); data.keys.push(k); open.add(k.id); draw(); }
          else msg.textContent = res?.status === 400 ? t('keys_invalid') : t('ah_action_failed');
        };
        data.keys.forEach(k => bindKey(list.querySelector(`.ak-card[data-k="${k.id}"]`), k));
      }

      function keyCard(k) {
        const on = k.apps.filter(a => a.enabled).length;
        return `<div class="ak-card" data-k="${k.id}" style="border-bottom:1px solid var(--border)">
          <div class="ak-head" style="display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer">
            <span style="width:14px;color:var(--text-dim)">${open.has(k.id) ? '▾' : '▸'}</span>
            <span style="font-size:1.1rem">🔑</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.9rem">${esc(k.name)}</div>
              <div style="font-size:.74rem;color:var(--text-dim)">${esc(svcLabel(k.service))} · ••••${esc(k.key.last4)} · ${esc(t('ah_keys_apps_count').replace('{n}', on))}</div>
            </div>
          </div>
          ${open.has(k.id) ? keyBody(k) : ''}
        </div>`;
      }

      function keyBody(k) {
        return `<div style="padding:0 16px 14px 40px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input class="ak-rename" value="${esc(k.name)}" style="${inp};width:170px">
            <input class="ak-newkey" type="password" autocomplete="off" placeholder="${esc(t('ah_keys_replace'))}" style="${inp};flex:1;min-width:150px">
            <button class="ak-save s-btn s-btn-sm" style="cursor:pointer">${esc(t('keys_save'))}</button>
            <button class="ak-del s-btn s-btn-sm" style="cursor:pointer">${esc(t('ah_delete'))}</button>
            <a href="${esc((data.services.find(x => x.service === k.service) || {}).help_url || '#')}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--accent)">${esc(t('keys_get'))}</a>
            <div class="ak-kmsg" style="width:100%;font-size:.78rem;min-height:14px;${err}"></div>
          </div>
          <strong style="font-size:.82rem">${esc(t('ah_keys_apps_for'))}</strong>
          ${k.apps.length ? k.apps.map(a => appRow(k, a)).join('') : `<div style="font-size:.8rem;color:var(--text-dim)">${esc(t('ah_keys_no_apps'))}</div>`}
        </div>`;
      }

      function appRow(k, a) {
        const id = k.id + ':' + a.id, isOpen = a.enabled && openApp.has(id);
        const sum = !a.enabled ? '' : a.all_users ? t('ah_keys_everyone') : t('ah_keys_people_count').replace('{n}', a.user_ids.length);
        return `<div class="ak-app" data-a="${esc(a.id)}" style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 10px">
            <input type="checkbox" class="ak-en" ${a.enabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
            <span style="font-size:1.1rem">${mvmOS.iconHTML(a)}</span>
            <span class="ak-open" style="flex:1;font-size:.86rem;${a.enabled ? 'cursor:pointer' : 'color:var(--text-dim)'}">${esc(mvmOS.appName(a))}</span>
            <span style="font-size:.74rem;color:var(--text-dim)">${esc(sum)}</span>
            ${a.enabled ? `<span class="ak-open" style="cursor:pointer;color:var(--text-dim)">${isOpen ? '▾' : '▸'}</span>` : ''}
          </div>
          ${isOpen ? peoplePanel(a) : ''}
        </div>`;
      }

      function peoplePanel(a) {
        const chips = a.user_ids.map(uid => data.users.find(u => u.id === uid)).filter(Boolean).map(u => `
          <span class="ak-chip" data-u="${esc(u.id)}" style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:99px;background:var(--surface2);border:1px solid var(--border);font-size:.78rem">
            ${esc(u.display_name)}<span class="ak-x" style="cursor:pointer;color:var(--text-dim)">✕</span></span>`).join('');
        return `<div style="padding:8px 10px 12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:16px;font-size:.84rem">
            <label style="cursor:pointer;display:flex;gap:6px;align-items:center"><input type="radio" name="m-${esc(a.id)}" class="ak-mode" value="all" ${a.all_users ? 'checked' : ''}>${esc(t('ah_keys_users_all'))}</label>
            <label style="cursor:pointer;display:flex;gap:6px;align-items:center"><input type="radio" name="m-${esc(a.id)}" class="ak-mode" value="sel" ${a.all_users ? '' : 'checked'}>${esc(t('ah_keys_users_selected'))}</label>
          </div>
          ${a.all_users ? '' : `<div style="position:relative">
            <input class="ak-search" autocomplete="off" placeholder="${esc(t('ah_keys_search'))}" style="${inp};width:100%;box-sizing:border-box">
            <div class="ak-sugg" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:5;max-height:200px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:2px"></div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${chips || `<span style="font-size:.78rem;color:var(--text-dim)">${esc(t('ah_keys_no_people_chosen'))}</span>`}</div>`}
        </div>`;
      }

      function bindKey(card, k) {
        const redraw = () => { draw(); };
        card.querySelector('.ak-head').onclick = () => { open.has(k.id) ? open.delete(k.id) : open.add(k.id); redraw(); };
        if (!open.has(k.id)) return;
        const kmsg = card.querySelector('.ak-kmsg');
        card.querySelector('.ak-save').onclick = async () => {
          const body = { name: card.querySelector('.ak-rename').value };
          const nk = card.querySelector('.ak-newkey').value.trim();
          if (nk) body.key = nk;
          const res = await call('PATCH', `${BASE}/${k.id}`, body);
          if (res?.ok) { Object.assign(k, await res.json()); redraw(); }
          else kmsg.textContent = res?.status === 400 ? t('keys_invalid') : t('ah_action_failed');
        };
        card.querySelector('.ak-del').onclick = async () => {
          if (!(await window.mvmOS?.confirm(t('ah_keys_delete_confirm').replace('{name}', k.name)))) return;
          const res = await call('DELETE', `${BASE}/${k.id}`);
          if (res?.ok) { data.keys = data.keys.filter(x => x.id !== k.id); redraw(); } else kmsg.textContent = t('ah_action_failed');
        };
        card.querySelectorAll('.ak-app').forEach(row => {
          const a = k.apps.find(x => x.id === row.dataset.a);
          const id = k.id + ':' + a.id;
          const save = async () => {
            const res = await call('PUT', `${BASE}/${k.id}/apps/${encodeURIComponent(a.id)}`,
              { enabled: a.enabled, all_users: a.all_users, user_ids: a.user_ids });
            if (!res?.ok) kmsg.textContent = t('ah_action_failed'); else kmsg.textContent = '';
          };
          row.querySelector('.ak-en').onchange = async e => {
            a.enabled = e.target.checked; if (a.enabled) openApp.add(id); else openApp.delete(id);
            await save(); redraw();
          };
          row.querySelectorAll('.ak-open').forEach(el => el.onclick = () => {
            if (!a.enabled) return; openApp.has(id) ? openApp.delete(id) : openApp.add(id); redraw();
          });
          row.querySelectorAll('.ak-mode').forEach(m => m.onchange = async () => { a.all_users = m.value === 'all'; await save(); redraw(); });
          row.querySelectorAll('.ak-x').forEach(x => x.onclick = async () => {
            a.user_ids = a.user_ids.filter(u => u !== x.parentElement.dataset.u); await save(); redraw();
          });
          const search = row.querySelector('.ak-search'), sugg = row.querySelector('.ak-sugg');
          if (search) {
            const show = () => {
              const q = search.value.trim().toLowerCase();
              const hits = data.users.filter(u => !a.user_ids.includes(u.id) &&
                (!q || (u.display_name + ' ' + u.username).toLowerCase().includes(q))).slice(0, 30);
              sugg.innerHTML = hits.map(u => `<div class="ak-pick" data-u="${esc(u.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:.84rem">
                ${renderAvatar(u, 22)}<span>${esc(u.display_name)} <span style="color:var(--text-dim);font-size:.74rem">@${esc(u.username)}</span></span></div>`).join('') +
                (hits.length ? '' : `<div style="padding:8px 10px;font-size:.8rem;color:var(--text-dim)">${esc(t('ah_keys_no_match'))}</div>`);
              sugg.style.display = '';
              sugg.querySelectorAll('.ak-pick').forEach(el => {
                el.onmouseenter = () => el.style.background = 'var(--surface2)';
                el.onmouseleave = () => el.style.background = '';
                el.onmousedown = async ev => { ev.preventDefault(); a.user_ids.push(el.dataset.u); await save(); redraw(); };
              });
            };
            search.oninput = show; search.onfocus = show;
            search.onblur = () => setTimeout(() => { sugg.style.display = 'none'; }, 120);
          }
        });
      }

      draw();
    }

    // ── Users tab ──────────────────────────────────────────────
    async function renderUsers(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      if (!_pubUser) _pubUser = await getUser();
      if (_favs === null) await _loadFavs();
      const [statsRes, usersRes, setRes] = await Promise.all([
        fetch('/api/apphub/stats').catch(()=>null),
        fetch('/api/apphub/users').catch(()=>null),
        fetch('/api/apphub/settings').catch(()=>null),
      ]);

      let stats = null;
      if (statsRes?.ok) stats = await statsRes.json();
      if (!usersRes?.ok) { c.innerHTML = `<div style="padding:20px;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.85rem">${t('ah_error_loading_users')}</div>`; return; }
      const users = await usersRes.json();
      const settings = setRes?.ok ? await setRes.json() : null;

      c.innerHTML = `
        ${settings ? `<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="ah-reg-toggle" ${settings.registrations_enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
            <span style="font-size:.85rem;font-weight:500">${t('ah_allow_registrations')}</span>
          </label>
          <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_registrations_hint')}</div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="ah-invite-toggle" ${settings.invitations_enabled?'checked':''} style="width:16px;height:16px">
            <span style="font-size:.85rem;font-weight:500">${t('ah_allow_invitations')}</span>
          </label>
          <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_invitations_hint')}</div>
        </div>` : ''}
        ${stats ? `<div style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);align-items:center">
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.total_users}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_total_users')}</div>
          </div>
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.active_sessions}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_active_sessions')}</div>
          </div>
        </div>` : ''}
        <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
          <button id="ah-add-user" class="s-btn s-btn-sm" style="background:var(--accent);color:var(--on-accent,#fff);font-weight:600;cursor:pointer">＋ ${t('ah_add_user')}</button>
        </div>
        <div id="ah-users-list"></div>`;

      const inviteToggle = c.querySelector('#ah-invite-toggle');
      if (inviteToggle) inviteToggle.onchange = async () => {
        inviteToggle.disabled = true;
        const response = await fetch('/api/apphub/settings', {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({invitations_enabled: inviteToggle.checked})
        }).catch(() => null);
        if (!response?.ok) { inviteToggle.checked = !inviteToggle.checked; window.alert(t('ah_action_failed')); }
        inviteToggle.disabled = false;
      };
      const regToggle = c.querySelector('#ah-reg-toggle');
      if (regToggle) regToggle.onchange = async () => {
        await fetch('/api/apphub/settings', {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ registrations_enabled: regToggle.checked }),
        }).catch(()=>null);
      };
      c.querySelector('#ah-add-user').onclick = () => _openUserModal(null, () => renderUsers(c));

      if (!users.length) {
        c.querySelector('#ah-users-list').innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('ah_no_users_yet')}</div>`;
        return;
      }
      // Credits are premium. Inside mvmOS the control stays where it is even
      // without a licence — this is the one place where the person looking at
      // it can actually get one — but it shows no balance, because there is no
      // balance to read, and clicking it opens the premium modal instead.
      const _hasCredits = await fetch('/api/apphub/features')
        .then(r => r.ok ? r.json() : {credits:false}).catch(() => ({credits:false}))
        .then(f => !!f.credits);
      const balances = _hasCredits ? await Promise.all(users.map(u =>
        fetch(`/api/apphub/credits/${u.id}`).then(r => r.ok ? r.json() : {balance:0}).catch(() => ({balance:0}))
      )) : users.map(() => ({balance: null}));

      c.querySelector('#ah-users-list').innerHTML = users.map((u, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--border)">
          ${renderAvatar(u, 32)}
          <div style="flex:1;min-width:0">
            <div style="font-size:.88rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.display_name)}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">@${esc(u.username)} · ${new Date(u.created_at).toLocaleDateString()}</div>
          </div>
          ${_pubUser && u.id !== _pubUser.id ? `<button class="ah-fav" data-id="${u.id}"
                  style="border:none;background:none;color:var(--accent);font-size:1rem;cursor:pointer;padding:4px 8px;border-radius:6px">${_isFav(u.id)?'★':'☆'}</button>` : ''}
          <button class="ah-credits" data-id="${u.id}" data-name="${esc(u.display_name)}" data-balance="${balances[i].balance ?? ''}"
                  style="border:1px solid var(--border);background:var(--surface2);color:var(--fg,inherit);font-size:.78rem;cursor:pointer;padding:4px 10px;border-radius:6px;flex-shrink:0;white-space:nowrap">💳${balances[i].balance == null ? '' : ' ' + balances[i].balance}</button>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0" title="${t('ah_admin_title')}">
            <input type="checkbox" class="ah-admin" data-id="${u.id}" ${u.is_admin?'checked':''} style="width:15px;height:15px;cursor:pointer">
            <span style="font-size:.78rem;color:${u.is_admin?'var(--accent)':'var(--text-dim)'}">${t('ah_admin')}</span>
          </label>
          <button class="ah-edit" data-id="${u.id}"
                  style="border:none;background:none;color:var(--accent);font-size:.78rem;cursor:pointer;padding:4px 8px;border-radius:6px">${t('ah_edit')}</button>
          <button class="ah-del" data-id="${u.id}" data-name="${esc(u.display_name)}"
                  style="border:none;background:none;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.78rem;cursor:pointer;padding:4px 8px;border-radius:6px">${t('ah_delete')}</button>
        </div>`).join('');

      c.querySelectorAll('.ah-edit').forEach(btn => {
        btn.onclick = () => {
          const u = users.find(x => x.id === btn.dataset.id);
          if (u) _openUserModal(u, () => renderUsers(c));
        };
      });

      c.querySelectorAll('.ah-admin').forEach(cb => {
        cb.onchange = async () => {
          await fetch(`/api/apphub/users/${cb.dataset.id}/admin`, {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ is_admin: cb.checked }),
          }).catch(()=>null);
          renderUsers(c);
        };
      });

      c.querySelectorAll('.ah-fav').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const u = users.find(x => x.id === id);
          await _toggleFav(u);
          btn.textContent = _isFav(id) ? '★' : '☆';
        };
      });

      c.querySelectorAll('.ah-credits').forEach(btn => {
        btn.onclick = () => _openCreditsPanel(btn.dataset.id, btn.dataset.name, () => renderUsers(c));
        if (!_hasCredits) window.mvmOS?.premiumGate(btn, t('ah_credits_premium'));
      });

      c.querySelectorAll('.ah-del').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id, name = btn.dataset.name;
          if (await window.mvmOS?.confirm(t('ah_delete_user_confirm', {name}))) {
            await fetch(`/api/apphub/users/${id}`, {method:'DELETE'}).catch(()=>null);
            renderUsers(c);
          }
        };
      });
    }

    // ── Admin: credit-priced services ──────────────────────────────
    async function renderCreditServices(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      const r = await fetch('/api/apphub/credit-services').catch(() => null);
      if (!r?.ok) { c.innerHTML = `<div style="padding:22px;color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9))">${t('ah_credits_load_failed')}</div>`; return; }
      const data = await r.json();
      const services = data.services || [];
      c.innerHTML = `
        <div style="padding:18px;display:flex;flex-direction:column;gap:14px">
          <div style="padding:14px 15px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);line-height:1.45">
            <div style="font-weight:700;margin-bottom:5px">${t('ah_credit_services_title')}</div>
            <div style="font-size:.82rem;color:var(--text-dim)">${data.premium ? t('ah_credit_services_hint') : t('ah_credit_services_paused')}</div>
          </div>
          <div id="ah-credit-service-list" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>`;
      const list = c.querySelector('#ah-credit-service-list');
      if (!services.length) { list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:.84rem">${t('ah_credit_services_none')}</div>`; return; }
      const apps = services.reduce((groups, service) => {
        const group = groups[service.app_id] || (groups[service.app_id] = { ...service, services: [] });
        group.services.push(service); return groups;
      }, {});
      list.innerHTML = Object.values(apps).map(app => `
        <details open style="border:1px solid var(--border);border-radius:10px;background:var(--surface1);overflow:hidden">
          <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:13px 14px;background:var(--surface2);user-select:none">
            <span style="font-size:1.35rem">${esc(app.app_icon)}</span>
            <span style="flex:1"><span style="display:block;font-weight:700;font-size:.9rem">${esc(mvmOS.appName({ name: app.app_name, name_i18n: app.app_name_i18n }))}</span><span style="display:block;margin-top:2px;font-size:.75rem;color:var(--text-dim)">${app.services.length} ${t('ah_credit_services_options')}</span></span>
            <span style="font-size:.85rem;color:var(--text-dim)">⌄</span>
          </summary>
          <div style="padding:0 14px">
            ${app.services.map(s => `<div style="display:flex;gap:12px;align-items:center;padding:13px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;min-width:0"><div style="font-weight:650;font-size:.87rem">${esc(s.name)}</div>${s.description ? `<div style="font-size:.76rem;color:var(--text-dim);margin-top:3px">${esc(s.description)}</div>` : ''}</div>
              <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:.78rem;color:var(--text-dim)">
                <input class="ah-service-price" data-app="${esc(s.app_id)}" data-feature="${esc(s.feature_id)}" type="number" min="0" max="1000000" step="1" value="${s.saved_price}" ${data.premium ? '' : 'disabled'} style="width:70px;background:var(--surface1);border:1px solid var(--border);border-radius:6px;padding:6px;color:inherit"> ${t('ah_credits_unit')}
              </label>
              <button class="ah-service-save s-btn s-btn-sm" data-app="${esc(s.app_id)}" data-feature="${esc(s.feature_id)}" ${data.premium ? '' : 'disabled'} style="cursor:pointer">${t('ah_save')}</button>
            </div>`).join('')}
          </div>
        </details>`).join('');
      list.querySelectorAll('.ah-service-save').forEach(btn => btn.onclick = async () => {
        const input = list.querySelector(`.ah-service-price[data-app="${btn.dataset.app}"][data-feature="${btn.dataset.feature}"]`);
        const price = Number.parseInt(input.value, 10);
        if (!Number.isInteger(price) || price < 0) return;
        btn.disabled = true;
        const save = await fetch(`/api/apphub/credit-services/${encodeURIComponent(btn.dataset.app)}/${encodeURIComponent(btn.dataset.feature)}`, {
          method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({price})
        }).catch(() => null);
        if (!save?.ok) { window.mvmOS?.premiumGate(btn, t('ah_credits_premium')); }
        btn.disabled = false;
      });
      // Without Premium the prices are shown but locked; a click opens the Premium dialog.
      if (!data.premium) window.mvmOS?.premiumGate?.(list, t('ah_credits_premium'));
    }

    // ── Admin: create / edit a user ────────────────────────────────
    function _openUserModal(user, onSave) {
      const isEdit = !!user;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `
        <div style="background:var(--surface1,#181825);border:1px solid var(--border);border-radius:12px;width:340px;max-width:92vw;display:flex;flex-direction:column;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-weight:600;font-size:.92rem">${isEdit?t('ah_edit_user_title'):t('ah_new_user_title')}</div>
          <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
            <input class="s-inp" id="um-dn" placeholder="${t('ah_display_name_ph')}" value="${isEdit?esc(user.display_name):''}">
            <input class="s-inp" id="um-un" placeholder="${t('ah_username_ph')}" autocomplete="off" value="${isEdit?esc(user.username):''}">
            <input class="s-inp" id="um-pw" type="password" placeholder="${isEdit?t('ah_password_keep_ph'):t('ah_password_min_ph')}" autocomplete="new-password">
            <div class="s-err" id="um-err" style="color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.8rem;min-height:16px"></div>
          </div>
          <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
            <button id="um-cancel" class="s-btn s-btn-sm" style="cursor:pointer">${t('ah_cancel')}</button>
            <button id="um-save" class="s-btn s-btn-sm" style="background:var(--accent);color:var(--on-accent,#fff);font-weight:600;cursor:pointer">${t('ah_save')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      overlay.querySelector('#um-cancel').onclick = close;

      overlay.querySelector('#um-save').onclick = async () => {
        const dn  = overlay.querySelector('#um-dn').value.trim();
        const un  = overlay.querySelector('#um-un').value.trim();
        const pw  = overlay.querySelector('#um-pw').value;
        const err = overlay.querySelector('#um-err');
        if (!dn || !un || (!isEdit && !pw)) { err.textContent = t('ah_fill_all_fields'); return; }
        const body = { display_name: dn, username: un, avatar_color: user?.avatar_color || '#89b4fa' };
        if (pw) body.password = pw;
        const btn = overlay.querySelector('#um-save'); btn.disabled = true; err.textContent = '';
        const r = await fetch(isEdit ? `/api/apphub/users/${user.id}` : '/api/apphub/users', {
          method: isEdit ? 'PUT' : 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        }).catch(()=>null);
        if (r?.ok) { close(); onSave && onSave(); return; }
        const d = r ? await r.json().catch(()=>({})) : {};
        err.textContent = d.detail || t('ah_registration_failed');
        btn.disabled = false;
      };
      setTimeout(() => overlay.querySelector('#um-dn').focus(), 50);
    }

    // ── Admin: per-user credits panel ──────────────────────────────

    function _fmtTxTime(iso) {
      try { return new Date(iso).toLocaleString([], {dateStyle:'medium', timeStyle:'short', hour12:false}); }
      catch(_) { return iso; }
    }

    async function _openCreditsPanel(uid, name, onChange) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `
        <div style="background:var(--surface1,#181825);border:1px solid var(--border);border-radius:12px;width:380px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-weight:600;font-size:.92rem">${t('ah_credits_title', {name: esc(name)})}</div>
          <div style="padding:16px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--border)">
            <div id="cp-balance" style="text-align:center;font-size:1.6rem;font-weight:700">…</div>
            <div style="display:flex;gap:8px">
              <input id="cp-amount" type="number" min="1" step="1" placeholder="${t('ah_credits_amount_ph')}" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:inherit;font-size:.85rem">
              <button id="cp-add" style="border:none;border-radius:8px;padding:8px 14px;font-size:.85rem;font-weight:600;background:#a6e3a1;color:#1e1e2e;cursor:pointer">${t('ah_credits_add')}</button>
              <button id="cp-sub" style="border:none;border-radius:8px;padding:8px 14px;font-size:.85rem;font-weight:600;background:#f38ba8;color:#1e1e2e;cursor:pointer">${t('ah_credits_remove')}</button>
            </div>
            <input id="cp-reason" type="text" placeholder="${t('ah_credits_reason_ph')}" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:inherit;font-size:.82rem">
            <div id="cp-err" style="color:color-mix(in srgb,#f38ba8 35%,var(--text,#c9d1d9));font-size:.8rem;min-height:16px"></div>
          </div>
          <div style="padding:10px 16px;font-size:.78rem;font-weight:600;color:var(--text-dim)">${t('ah_credits_history')}</div>
          <div id="cp-history" style="flex:1;overflow-y:auto;padding:0 16px 16px;display:flex;flex-direction:column;gap:6px"></div>
          <div style="padding:10px 16px;border-top:1px solid var(--border);text-align:right">
            <button id="cp-close" style="border:none;background:none;color:var(--accent);font-size:.85rem;cursor:pointer;padding:6px 10px">${t('ah_credits_close')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      function close() { overlay.remove(); onChange && onChange(); }
      overlay.querySelector('#cp-close').onclick = close;

      async function load() {
        const r = await fetch(`/api/apphub/credits/${uid}`).catch(() => null);
        if (!r?.ok) { overlay.querySelector('#cp-balance').textContent = '—'; return; }
        const data = await r.json();
        overlay.querySelector('#cp-balance').textContent = data.balance;
        const hist = overlay.querySelector('#cp-history');
        if (!data.transactions.length) {
          hist.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:.8rem;padding:12px 0">${t('ah_credits_no_transactions')}</div>`;
          return;
        }
        hist.innerHTML = data.transactions.map(tx => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 10px;background:var(--surface2);border-radius:8px">
            <div style="min-width:0">
              <div style="font-size:.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tx.reason || tx.app_id)}</div>
              <div style="font-size:.7rem;color:var(--text-dim)">${esc(tx.app_id)} · ${_fmtTxTime(tx.created_at)}</div>
            </div>
            <div style="font-size:.85rem;font-weight:700;color:${tx.delta>=0?'#a6e3a1':'#f38ba8'};flex-shrink:0">${tx.delta>=0?'+':''}${tx.delta}</div>
          </div>`).join('');
      }

      async function submit(kind) {
        const amountEl = overlay.querySelector('#cp-amount');
        const reasonEl = overlay.querySelector('#cp-reason');
        const errEl    = overlay.querySelector('#cp-err');
        const amount = parseInt(amountEl.value, 10);
        errEl.textContent = '';
        if (!amount || amount <= 0) { errEl.textContent = t('ah_credits_enter_amount'); return; }
        const reason = reasonEl.value.trim() || (kind === 'grant' ? t('ah_credits_added_default') : t('ah_credits_removed_default'));
        const r = await fetch(`/api/apphub/credits/${uid}/${kind === 'grant' ? 'grant' : 'deduct'}`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ amount, reason }),
        }).catch(() => null);
        if (!r?.ok) { errEl.textContent = t('ah_credits_save_failed'); return; }
        amountEl.value = ''; reasonEl.value = '';
        await load();
      }
      overlay.querySelector('#cp-add').onclick = () => submit('grant');
      overlay.querySelector('#cp-sub').onclick = () => submit('deduct');

      await load();
    }

    setTab(_activeTab);
  }


  // ── Profile button in the title bar of Apps Hub apps ────────────
  // Every desktop window of an app that belongs to Apps Hub shows who is
  // signed in, like the header of the public pages, and opens a small menu
  // with the profile, the app's own settings (when it has any) and logout.
  const _winBtns = new Set();
  let _winInit = false;

  async function _paintWinProfiles(force) {
    _winBtns.forEach(b => { if (!b.isConnected) _winBtns.delete(b); });
    if (!_winBtns.size) return;
    const token = getToken();
    if (!token) { _menuUser = null; _menuToken = null; }
    else if (force || _menuToken !== token || !_menuUser || Date.now() - _menuAt > 30000) {
      _menuUser = await getUser();
      _menuToken = _menuUser ? token : null;
      _menuAt = Date.now();
    }
    const user = token ? _menuUser : null;
    _winBtns.forEach(b => {
      b.innerHTML = user ? renderAvatar(user, 18) : '<span aria-hidden="true">👤</span>';
      b.title = user ? `${user.display_name || user.username} (@${user.username}) · ${_t('app_apphub')}` : _t('ah_login');
      b.setAttribute('aria-label', b.title);
    });
  }

  function _closeWinMenu() {
    document.querySelector('.win-profile-menu')?.remove();
    document.removeEventListener('mousedown', _winMenuOutside, true);
    document.removeEventListener('keydown', _winMenuKey, true);
  }
  function _winMenuOutside(e) { if (!e.target.closest('.win-profile-menu')) _closeWinMenu(); }
  function _winMenuKey(e) { if (e.key === 'Escape') _closeWinMenu(); }

  async function _winLogout() {
    await fetch('/api/pub/apphub/logout', {method:'POST',headers:{'X-Pub-Token':getToken()}}).catch(()=>{});
    localStorage.removeItem('apphub_token');
    _pubUser = null;
    window.dispatchEvent(new CustomEvent('apphub_logout'));
  }

  function _openWinMenu(btn) {
    const reopen = document.querySelector('.win-profile-menu')?._owner !== btn;
    _closeWinMenu();
    if (!reopen) return;
    const user = _menuToken === getToken() ? _menuUser : null;
    const menu = document.createElement('div');
    menu.className = 'win-profile-menu';
    menu._owner = btn;
    menu.innerHTML =
      (user ? `<div class="win-profile-head">${renderAvatar(user, 34)}<div><strong>${esc(user.display_name || user.username)}</strong><span>@${esc(user.username)} · ${esc(_t('app_apphub'))}</span></div></div>` : '') +
      `<button data-act="profile">${esc(_t('win_profile_open'))}</button>` +
      (btn._onSettings ? `<button data-act="settings">${esc(_t('app_settings_title'))}</button>` : '') +
      (user ? `<button data-act="logout">${esc(_t('ah_logout'))}</button>` : '');
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    menu.addEventListener('click', e => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      _closeWinMenu();
      if (act === 'profile') openWindow('account');
      else if (act === 'settings') btn._onSettings?.();
      else if (act === 'logout') _winLogout();
    });
    document.addEventListener('mousedown', _winMenuOutside, true);
    document.addEventListener('keydown', _winMenuKey, true);
    menu.querySelector('button')?.focus();
  }

  function mountWindowProfile(btn, opts) {
    if (!btn) return;
    if (!_winInit) {
      _winInit = true;
      window.addEventListener('apphub_login', () => _paintWinProfiles(true));
      window.addEventListener('apphub_logout', () => _paintWinProfiles(true));
      window.addEventListener('storage', e => { if (e.key === 'apphub_token') _paintWinProfiles(true); });
    }
    btn._onSettings = opts?.onSettings || null;
    _winBtns.add(btn);
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.stopPropagation(); _openWinMenu(btn); });
    // The window is added to the page right after this call; painting waits for it.
    setTimeout(() => _paintWinProfiles(false), 0);
  }

  return { openWindow, getToken, getUser, requireLogin, mountWindowProfile };
})();
