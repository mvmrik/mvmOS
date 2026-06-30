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

    const tabs = [
      { id: 'account', label: '👤 My Account' },
      { id: 'apps',    label: '🔲 Public Apps', adminOnly: true },
      { id: 'users',   label: '👥 Users',        adminOnly: true },
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
          <div style="font-weight:600;font-size:.95rem">Sign in to Apps Hub</div>
          <div style="display:flex;gap:0;background:var(--surface2);border-radius:8px;padding:3px">
            <button id="ah-tab-login" style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:var(--accent);color:#1e1e2e;font-weight:600">Login</button>
            <button id="ah-tab-reg"   style="flex:1;border:none;border-radius:6px;padding:6px;font-size:.82rem;font-family:inherit;cursor:pointer;background:none;color:var(--text-dim)">Register</button>
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
            <input class="s-inp" id="ah-un" placeholder="Username" autocomplete="username">
            <input class="s-inp" id="ah-pw" type="password" placeholder="Password" autocomplete="current-password">
            <div class="s-err" id="ah-err" style="color:#f38ba8;font-size:.82rem;min-height:16px"></div>
            <button class="s-btn" id="ah-login-btn" style="background:var(--accent);color:#1e1e2e;font-weight:600">Login</button>
          </div>`;
        const btn = loginForm.querySelector('#ah-login-btn');
        const err = loginForm.querySelector('#ah-err');
        btn.onclick = async () => {
          const un = loginForm.querySelector('#ah-un').value.trim();
          const pw = loginForm.querySelector('#ah-pw').value;
          if (!un || !pw) { err.textContent = 'Fill in all fields'; return; }
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
            err.textContent = d.detail || 'Login failed';
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
          <input class="s-inp" id="ah-r-dn" placeholder="Display name">
          <input class="s-inp" id="ah-r-un" placeholder="Username" autocomplete="username">
          <input class="s-inp" id="ah-r-pw" type="password" placeholder="Password (min 4 chars)" autocomplete="new-password">
          <div style="color:#f38ba8;font-size:.82rem;min-height:16px" id="ah-r-err"></div>
          <button class="s-btn" id="ah-reg-btn" style="background:var(--accent);color:#1e1e2e;font-weight:600">Create account</button>`;
        const btn = regForm.querySelector('#ah-reg-btn');
        const err = regForm.querySelector('#ah-r-err');
        btn.onclick = async () => {
          const dn = regForm.querySelector('#ah-r-dn').value.trim();
          const un = regForm.querySelector('#ah-r-un').value.trim();
          const pw = regForm.querySelector('#ah-r-pw').value;
          if (!dn||!un||!pw) { err.textContent = 'Fill in all fields'; return; }
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
            err.textContent = d.detail || 'Registration failed';
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
                Edit profile ↗
              </a>
              <button id="ah-logout" style="border:none;background:none;color:var(--text-dim);font-size:.78rem;cursor:pointer;font-family:inherit;padding:4px 10px;border:1px solid var(--border);border-radius:6px">Logout</button>
            </div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:.82rem;color:var(--text-dim);line-height:1.6">
            Your Apps Hub account is active. Apps that support Apps Hub will recognize you automatically.
          </div>
        </div>`;
      c.querySelector('#ah-logout').onclick = async () => {
        await fetch('/api/pub/apphub/logout', {method:'POST',headers:{'X-Pub-Token':getToken()}}).catch(()=>{});
        localStorage.removeItem('apphub_token');
        _pubUser = null;
        _renderLogin(c);
      };
    }

    // ── Public Apps tab ────────────────────────────────────────
    async function renderApps(c) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
      const r = await fetch('/api/apphub/public-apps').catch(()=>null);
      if (!r?.ok) { c.innerHTML = '<div style="padding:20px;color:#f38ba8;font-size:.85rem">Error loading apps</div>'; return; }
      const apps = await r.json();
      if (!apps.length) { c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">No public-capable apps detected.</div>'; return; }

      c.innerHTML = `
        <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
          Apps with <code>public.py</code> are detected automatically. Toggle to make them accessible at /pub/&lt;id&gt;/.
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
              <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?'Public':'Private'}</span>
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
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/apphub/stats').catch(()=>null),
        fetch('/api/apphub/users').catch(()=>null),
      ]);

      let stats = null;
      if (statsRes?.ok) stats = await statsRes.json();
      if (!usersRes?.ok) { c.innerHTML = '<div style="padding:20px;color:#f38ba8;font-size:.85rem">Error loading users</div>'; return; }
      const users = await usersRes.json();

      c.innerHTML = `
        ${stats ? `<div style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)">
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.total_users}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">Total users</div>
          </div>
          <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:1.3rem;font-weight:700">${stats.active_sessions}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">Active sessions</div>
          </div>
        </div>` : ''}
        <div id="ah-users-list"></div>`;

      if (!users.length) {
        c.querySelector('#ah-users-list').innerHTML = '<div style="padding:24px;color:var(--text-dim);font-size:.85rem;text-align:center">No registered users yet.</div>';
        return;
      }
      c.querySelector('#ah-users-list').innerHTML = users.map(u => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--border)">
          ${renderAvatar(u, 32)}
          <div style="flex:1;min-width:0">
            <div style="font-size:.88rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.display_name)}</div>
            <div style="font-size:.72rem;color:var(--text-dim)">@${esc(u.username)} · ${new Date(u.created_at).toLocaleDateString()}</div>
          </div>
          <button class="ah-del" data-id="${u.id}" data-name="${esc(u.display_name)}"
                  style="border:none;background:none;color:#f38ba8;font-size:.78rem;cursor:pointer;padding:4px 8px;border-radius:6px">Delete</button>
        </div>`).join('');

      c.querySelectorAll('.ah-del').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id, name = btn.dataset.name;
          window.mvmOS?.confirm(`Delete user "${name}"? This will revoke all their sessions.`, async () => {
            await fetch(`/api/apphub/users/${id}`, {method:'DELETE'}).catch(()=>null);
            renderUsers(c);
          });
        };
      });
    }

    setTab(_activeTab);
  }

  return { openWindow, getToken, getUser, requireLogin };
})();
