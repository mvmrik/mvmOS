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
      { id: 'users',      label: t('ah_tab_users'), adminOnly: true },
    ];

    body.innerHTML = `
      <div style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0">
        ${tabs.map(t => `<button class="ah-tab" data-t="${t.id}"
          style="background:none;border:none;border-bottom:2px solid transparent;padding:10px 14px;font-size:.85rem;color:var(--text-dim);cursor:pointer;font-family:inherit;white-space:nowrap"
          >${t.label}</button>`).join('')}
      </div>
      <div id="ah-body" style="flex:1;overflow-y:auto"></div>`;

    function setTab(id) {
      _activeTab = id;
      body.querySelectorAll('.ah-tab').forEach(t => {
        const active = t.dataset.t === id;
        t.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
        t.style.borderColor = active ? 'var(--accent)' : 'transparent';
      });
      const c = body.querySelector('#ah-body');
      if (id === 'account') renderAccount(c);
      else if (id === 'favourites') renderFavourites(c);
      else if (id === 'apps')  renderApps(c);
      else if (id === 'users') renderUsers(c);
    }

    body.querySelectorAll('.ah-tab').forEach(t => {
      t.onclick = () => setTab(t.dataset.t);
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

    function _renderLogin(c) {
      c.innerHTML = `
        <div style="padding:20px;display:flex;flex-direction:column;gap:16px;max-width:340px">
          <div style="font-weight:600;font-size:.95rem">${t('ah_signin_title')}</div>
          <div style="display:flex;gap:0;background:var(--surface2);border-radius:8px;padding:3px">
            <button id="ah-tab-login" style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:#1e1e2e;font-weight:600">${t('ah_login')}</button>
            <button id="ah-tab-reg"   style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)">${t('ah_register')}</button>
          </div>
          <div id="ah-login-form"></div>
          <div id="ah-reg-form" style="display:none;flex-direction:column;gap:10px"></div>
        </div>`;

      const loginForm = c.querySelector('#ah-login-form');
      const regForm   = c.querySelector('#ah-reg-form');

      function showLogin() {
        c.querySelector('#ah-tab-login').style.cssText = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:#1e1e2e;font-weight:600';
        c.querySelector('#ah-tab-reg').style.cssText   = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)';
        loginForm.style.display = '';
        regForm.style.display   = 'none';
        loginForm.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px">
            <input class="s-inp" id="ah-un" placeholder="${t('ah_username_ph')}" autocomplete="username">
            <input class="s-inp" id="ah-pw" type="password" placeholder="${t('ah_password_ph')}" autocomplete="current-password">
            <div class="s-err" id="ah-err" style="color:#f38ba8;font-size:.82rem;min-height:16px"></div>
            <button class="s-btn" id="ah-login-btn" style="background:var(--accent);color:#1e1e2e;font-weight:600">${t('ah_login')}</button>
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
        c.querySelector('#ah-tab-reg').style.cssText   = 'flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:#1e1e2e;font-weight:600';
        loginForm.style.display = 'none';
        regForm.style.display   = 'flex';
        regForm.innerHTML = `
          <input class="s-inp" id="ah-r-dn" placeholder="${t('ah_display_name_ph')}">
          <input class="s-inp" id="ah-r-un" placeholder="${t('ah_username_ph')}" autocomplete="username">
          <input class="s-inp" id="ah-r-pw" type="password" placeholder="${t('ah_password_min_ph')}" autocomplete="new-password">
          <div style="color:#f38ba8;font-size:.82rem;min-height:16px" id="ah-r-err"></div>
          <button class="s-btn" id="ah-reg-btn" style="background:var(--accent);color:#1e1e2e;font-weight:600">${t('ah_create_account')}</button>`;
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

      c.querySelector('#ah-tab-login').onclick = showLogin;
      c.querySelector('#ah-tab-reg').onclick   = showReg;
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
      if (!r?.ok) { c.innerHTML = `<div style="padding:20px;color:#f38ba8;font-size:.85rem">${t('ah_error_loading_apps')}</div>`; return; }
      const apps = await r.json();
      if (!apps.length) { c.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('ah_no_public_apps')}</div>`; return; }

      c.innerHTML = `
        <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
          ${t('ah_public_apps_hint')}
        </div>
        <div id="ah-apps-list"></div>`;

      function render(list) {
        list.innerHTML = apps.map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
            <span style="font-size:1.4rem">${esc(a.icon)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.88rem;font-weight:500">${esc(a.name)}</div>
              <div style="font-size:.72rem;color:var(--text-dim)">/pub/${esc(a.id)}/</div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
              <input type="checkbox" data-id="${a.id}" ${a.enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
              <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?t('ah_public'):t('ah_private')}</span>
            </label>
            ${a.enabled ? `<a href="/pub/${a.id}/" target="_blank" style="font-size:.75rem;color:var(--accent);text-decoration:none">↗</a>` : ''}
          </div>`).join('');

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
      }
      render(c.querySelector('#ah-apps-list'));
    }

    // ── Users tab ──────────────────────────────────────────────
    async function renderUsers(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      if (!_pubUser) _pubUser = await getUser();
      if (_favs === null) await _loadFavs();
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/apphub/stats').catch(()=>null),
        fetch('/api/apphub/users').catch(()=>null),
      ]);

      let stats = null;
      if (statsRes?.ok) stats = await statsRes.json();
      if (!usersRes?.ok) { c.innerHTML = `<div style="padding:20px;color:#f38ba8;font-size:.85rem">${t('ah_error_loading_users')}</div>`; return; }
      const users = await usersRes.json();

      c.innerHTML = `
        ${stats ? `<div style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)">
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.total_users}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_total_users')}</div>
          </div>
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.active_sessions}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">${t('ah_active_sessions')}</div>
          </div>
        </div>` : ''}
        <div id="ah-users-list"></div>`;

      if (!users.length) {
        c.querySelector('#ah-users-list').innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('ah_no_users_yet')}</div>`;
        return;
      }
      const balances = await Promise.all(users.map(u =>
        fetch(`/api/apphub/credits/${u.id}`).then(r => r.ok ? r.json() : {balance:0}).catch(() => ({balance:0}))
      ));

      c.querySelector('#ah-users-list').innerHTML = users.map((u, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--border)">
          ${renderAvatar(u, 32)}
          <div style="flex:1;min-width:0">
            <div style="font-size:.88rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.display_name)}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">@${esc(u.username)} · ${new Date(u.created_at).toLocaleDateString()}</div>
          </div>
          ${_pubUser && u.id !== _pubUser.id ? `<button class="ah-fav" data-id="${u.id}"
                  style="border:none;background:none;color:var(--accent);font-size:1rem;cursor:pointer;padding:4px 8px;border-radius:6px">${_isFav(u.id)?'★':'☆'}</button>` : ''}
          <button class="ah-credits" data-id="${u.id}" data-name="${esc(u.display_name)}" data-balance="${balances[i].balance}"
                  style="border:1px solid var(--border);background:var(--surface2);color:var(--fg,inherit);font-size:.78rem;cursor:pointer;padding:4px 10px;border-radius:6px;flex-shrink:0;white-space:nowrap">💳 ${balances[i].balance}</button>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0" title="${t('ah_admin_title')}">
            <input type="checkbox" class="ah-admin" data-id="${u.id}" ${u.is_admin?'checked':''} style="width:15px;height:15px;cursor:pointer">
            <span style="font-size:.78rem;color:${u.is_admin?'var(--accent)':'var(--text-dim)'}">${t('ah_admin')}</span>
          </label>
          <button class="ah-del" data-id="${u.id}" data-name="${esc(u.display_name)}"
                  style="border:none;background:none;color:#f38ba8;font-size:.78rem;cursor:pointer;padding:4px 8px;border-radius:6px">${t('ah_delete')}</button>
        </div>`).join('');

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
      });

      c.querySelectorAll('.ah-del').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id, name = btn.dataset.name;
          window.mvmOS?.confirm(t('ah_delete_user_confirm', {name}), async () => {
            await fetch(`/api/apphub/users/${id}`, {method:'DELETE'}).catch(()=>null);
            renderUsers(c);
          });
        };
      });
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
            <div id="cp-err" style="color:#f38ba8;font-size:.8rem;min-height:16px"></div>
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

  return { openWindow, getToken, getUser, requireLogin };
})();
