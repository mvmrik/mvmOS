// ── Game Launcher ────────────────────────────────────────────────────────────
// The shared shell behind every mvmOS game window.
//
// A game is played entirely on its public Game Hub page. That is the only
// context in which an Apps Hub account exists, so it is the only context in
// which anyone other than the single session logged into this desktop can
// play, be scored and show up in the leaderboards — and a game opened in its
// own tab gets the whole screen, which is what a game wants on a phone.
//
// The desktop window therefore holds no game logic at all. It launches the
// game and it hosts whatever belongs to the owner of the server rather than to
// a player: settings, premium switches, future admin panels. Players who come
// in from the public Game Hub simply get whatever the owner has configured.
//
// A game app's main.js is expected to be little more than:
//
//   mvmOS.registerApp({
//     id: 'towerdefense', name: …, icon: '🏰', category: 'Games',
//     launch() {
//       GameLauncher.open({
//         id: 'towerdefense', name: …, icon: '🏰',
//         tagline: …,                             // one line under the title
//         sections: [{ title, render(el) }],      // optional, owner-side only
//       });
//     },
//   });
//
// Everything else — single vs multiplayer, lobbies, invitations, scores — is
// chosen in Game Hub, so no game has to build (or translate) any of it twice.
//
// Game Hub is a hard requirement: without it there is no public page, no
// account and no scoreboard. When it is missing this shell says so and
// installs it in place, rather than showing a Play button that leads nowhere.

const GameLauncher = (() => {

  const HUB_ID  = 'gamehub';
  const HUB_PUB = '/pub/gamehub/';

  // Deep link straight into this game inside the public hub, so the player
  // lands on its Play / History / Leaderboard page instead of the game grid.
  function publicUrl(gameId) {
    return HUB_PUB + '?game=' + encodeURIComponent(gameId);
  }

  // Asked on every render rather than read from the plugin cache: the answer
  // changes the moment the user installs Game Hub from this very window.
  async function isHubInstalled() {
    try {
      const res = await fetch('/api/plugins');
      if (!res.ok) return false;
      const list = await res.json();
      return list.some(p => p.id === HUB_ID);
    } catch (_) {
      return false;
    }
  }

  // Game Hub's install payload, looked up in the connected stores (official
  // first). Returns null when no store carries it.
  async function _findHubInStore() {
    let stores = [];
    try {
      const res = await fetch('/api/plugins/stores');
      if (res.ok) stores = await res.json();
    } catch (_) {}
    stores.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0));
    for (const store of stores) {
      try {
        const res = await fetch(`/api/plugins/manifest?store_id=${store.id}`);
        if (!res.ok) continue;
        const apps = await res.json();
        const hub = apps.find(a => a.id === HUB_ID);
        if (hub) return { ...hub, official: store.official ?? 0, store_id: store.id };
      } catch (_) {}
    }
    return null;
  }

  async function _installHub(btn, onDone) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('gl_installing');

    const fail = msg => {
      btn.disabled = false;
      btn.textContent = orig;
      // Shown next to the button as well as in the bell: the window is right
      // here, and an install that silently does nothing looks like a bug.
      let err = btn.parentElement?.querySelector('.gl-err');
      if (!err && btn.parentElement) {
        err = document.createElement('div');
        err.className = 'gl-err';
        err.style.cssText = 'font-size:.8rem;color:var(--danger,#da3633);line-height:1.5';
        btn.parentElement.appendChild(err);
      }
      if (err) err.textContent = msg;
      mvmOS.notify(t('gl_install_failed'), msg);
    };

    const hub = await _findHubInStore();
    if (!hub) return fail(t('gl_hub_not_in_store'));

    async function post(body) {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json().catch(() => ({}));
    }

    let result = await post(hub);
    // Game Hub ships a server component (rooms, sockets, scores), so this
    // branch is the normal path, not an edge case.
    if (result.needs_backend_confirm) {
      const ok = await mvmOS.confirm(t('gl_backend_confirm'));
      if (!ok) { btn.disabled = false; btn.textContent = orig; return; }
      result = await post({ ...hub, install_backend: true });
    }

    if (result.min_core_version) {
      return fail(t('appstore_requires_core')
        .replace('{min}', result.min_core_version)
        .replace('{cur}', result.current_core_version));
    }
    if (!result.ok) return fail(result.error || t('gl_unknown_error'));

    mvmOS._loadPlugin(HUB_ID);
    if (onDone) onDone();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  // Any text field may be a function, so a game can hand over t('…') calls
  // that only resolve once its own string table has been merged.
  function _val(v) {
    return typeof v === 'function' ? v() : v;
  }

  // A game's translations live in apps/<id>/public/i18n.js and travel in its
  // store zip — the same file the public play page loads. Pulled in here so a
  // game's main.js does not have to repeat the loading dance.
  function _ensureGameI18n(gameId) {
    return new Promise(resolve => {
      const domId = 'game-i18n-' + gameId;
      if (document.getElementById(domId)) return resolve();
      const s = document.createElement('script');
      s.id = domId;
      s.src = `/apps/${gameId}/i18n.js?_=${Date.now()}`;
      s.onload = resolve;
      s.onerror = resolve;   // a game with no table of its own is fine
      document.head.appendChild(s);
    });
  }

  function _header(game) {
    const tagline = _val(game.tagline);
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
        <div style="font-size:56px;line-height:1">${_esc(game.icon || '🎮')}</div>
        <div style="font-size:1.15rem;font-weight:700">${_esc(_val(game.name) || game.id)}</div>
        ${tagline ? `<div style="font-size:.85rem;color:var(--text-dim);max-width:420px;line-height:1.5">${_esc(tagline)}</div>` : ''}
      </div>`;
  }

  function _sections(body, game) {
    if (!Array.isArray(game.sections) || !game.sections.length) return;
    game.sections.forEach(section => {
      if (!section || typeof section.render !== 'function') return;
      const box = document.createElement('div');
      box.style.cssText = 'border-top:1px solid var(--border);padding-top:16px;display:flex;flex-direction:column;gap:10px';
      if (section.title) {
        const h = document.createElement('div');
        h.style.cssText = 'font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px';
        h.textContent = section.title;
        box.appendChild(h);
      }
      const el = document.createElement('div');
      box.appendChild(el);
      body.appendChild(box);
      try { section.render(el); } catch (e) { console.error('[gamelauncher] section failed', e); }
    });
  }

  // Renders the launcher into an already-created window body. Exposed on its
  // own so a game with a richer window can drop the launcher into a tab.
  async function render(body, game) {
    body.style.cssText = 'padding:24px;display:flex;flex-direction:column;gap:18px;overflow:auto';
    // Only the waiting line at first: the header carries the game's own strings,
    // and its table is still loading — drawing it now would flash the raw keys.
    body.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:.85rem;padding:24px 0">${_esc(t('gl_checking'))}</div>`;

    const [installed] = await Promise.all([isHubInstalled(), _ensureGameI18n(game.id)]);
    body.innerHTML = _header(game);

    const panel = document.createElement('div');
    panel.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:center';
    body.appendChild(panel);

    if (installed) {
      const play = document.createElement('button');
      play.className = 's-btn';
      play.style.cssText = 'padding:10px 26px;font-size:.95rem';
      play.textContent = '▶ ' + t('gl_play');
      play.onclick = () => window.open(publicUrl(game.id), '_blank');
      panel.appendChild(play);

      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:.8rem;color:var(--text-dim);text-align:center;max-width:420px;line-height:1.5';
      hint.textContent = t('gl_play_hint');
      panel.appendChild(hint);
    } else {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius,6px);padding:16px;display:flex;flex-direction:column;gap:10px;max-width:460px;text-align:center';
      card.innerHTML = `
        <div style="font-weight:600">🎮 ${_esc(t('gl_hub_required_title'))}</div>
        <div style="font-size:.85rem;color:var(--text-dim);line-height:1.55">${_esc(t('gl_hub_required_body', { game: _val(game.name) || game.id }))}</div>`;
      const install = document.createElement('button');
      install.className = 's-btn';
      install.style.cssText = 'align-self:center;padding:9px 22px';
      install.textContent = t('gl_install_hub');
      install.onclick = () => _installHub(install, () => render(body, game));
      card.appendChild(install);
      panel.appendChild(card);
    }

    _sections(body, game);
  }

  function open(game) {
    mvmOS.createWindow({
      id: game.id,
      title: `${game.icon || '🎮'} ${_val(game.name) || game.id}`,
      width: game.width || 460,
      height: game.height || 420,
      onMount(body) { render(body, game); },
    });
  }

  return { open, render, publicUrl, isHubInstalled, HUB_ID, HUB_PUB };
})();

window.GameLauncher = GameLauncher;
