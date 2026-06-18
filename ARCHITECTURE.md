# mvmOS — Architecture Reference

## Project Structure

```
<install-dir>/
  backend/
    main.py           — FastAPI app, mounts all routers
    auth.py           — login, sessions, users
    system.py         — CPU, memory, disk, processes, services, power
    files.py          — file system
    plugins.py        — app install/uninstall, DB, _apply_schema
    widgets.py        — widget install/uninstall
    themes.py         — themes
    settings.py       — system settings
    updates.py        — core and app updates
    app_backends.py   — dynamic loader for app backend.py files
    apps/             — installed app backend files
      <app-id>/
        backend.py
    db.py             — SQLite connection, APPS_DIR, WIDGETS_DIR, THEMES_DIR
    cron.py           — cron jobs
    scheduler.py      — mvmOS App Scheduler (POST /api/scheduler/tick, GET /api/scheduler/status)
  frontend/
    index.html
    mvmos.js          — main JS, mvmOS object, SDK
    desktop.js        — windows, taskbar, start menu, tray
    appstore.js       — App Store UI
    i18n/
      en.js           — English strings
      bg.js           — Bulgarian strings
  apps/               — installed apps (served as static files)
    <app-id>/
      main.js
      style.css
      manifest.json
      db.json
      data.db
  widgets/            — installed widgets
  themes/             — installed themes
  version.txt         — current core version (e.g. 0.5.12-beta)
```

---

## Privilege Model

uvicorn runs as root so it can act as any Linux user. Each session carries an
`effective_user` (the user who logged in). The security rule: **a session may only
do what its `effective_user` is allowed to do on the host.**

- Shell/file operations run as the user via `runuser` — `backend/terminal.py`,
  `backend/files.py` (`run_as`), `backend/system.py` (`_as_user`). For a root
  session this is a no-op; for a non-root session, privileged commands fail with
  permission denied, and the caller's optional `sudo_password` path can escalate
  (same as typing `sudo` in a real shell).
- Operations on mvmOS / the host itself that have no per-user form (self-update,
  service restart of mvmOS, power) require `Depends(require_root_session)` in
  `backend/auth.py` — non-root sessions get 403.
- App backends follow the same rule (see App Backends).

Not yet converted: `POST /api/plugins/{id}/db` runs SQL in-process as root and is
shared across apps — app-level DB isolation is a separate task.

## mvmOS SDK (frontend/mvmos.js)

Global `mvmOS` object — available to all apps.

### mvmOS.registerApp(def)

```js
mvmOS.registerApp({
  id: 'my-app',
  name: 'My App',
  icon: '🚀',
  category: 'Utilities',
  trayable: true,          // optional — System Tray support
  settings: [...],         // must match manifest.json
  launch() { ... },
});
```

### mvmOS.createWindow(opts)

```js
mvmOS.createWindow({
  id, title, icon,
  width, height,
  onMount(body) { ... },   // body is the DOM element inside the window
  appSettings: true,       // shows gear button in titlebar
  onAppSettings() { ... }, // called when gear button is clicked
});
```

### mvmOS.db(appId)

```js
const db = mvmOS.db('my-app');
await db.query(sql, params);  // → rows[]
await db.run(sql, params);    // → rowcount
```

### mvmOS.notify(title, body, action?, actionLabel?)

```js
mvmOS.notify('Title', 'Message');
mvmOS.notify('Update', 'v2.0 available', () => openUpdate(), 'Install');
```

### mvmOS.system

| Method | Description |
|--------|-------------|
| `system.resources()` | CPU%, memory, disk, hardware (combined from /resources + /hardware) |
| `system.processes()` | List running processes |
| `system.kill(pid, signal?, sudo?)` | Send signal to process |
| `system.services()` | List systemd services |
| `system.serviceAction(name, action, sudo?)` | start/stop/restart/enable/disable |

### Direct system config endpoints (backend/system.py)

| Endpoint | Description |
|----------|-------------|
| `GET/POST /api/system/php-ini` | Read/write PHP FPM php.ini (whitelisted keys) |
| `GET/POST /api/system/mysql-cnf` | Read/write MySQL my.cnf (whitelisted keys) |
| `GET/POST /api/system/nginx-conf` | Read/write /etc/nginx/nginx.conf (whitelisted keys) |
| `POST /api/system/nginx-test` | Validate nginx config via `nginx -t` |
| `GET/POST /api/system/sshd-conf` | Read/write /etc/ssh/sshd_config (whitelisted keys) |
| `POST /api/system/sshd-test` | Validate sshd config via `sshd -t` |
| `GET /api/system/ufw-status` | UFW status and numbered rules list |
| `POST /api/system/ufw-toggle` | Enable/disable UFW |
| `POST /api/system/ufw-allow` | Add allow rule (`{ rule: "22/tcp" }`) |
| `POST /api/system/ufw-delete` | Delete rule by number (`{ num: 1 }`) |

### mvmOS.fs

| Method | Description |
|--------|-------------|
| `fs.list(path)` | List directory contents |
| `fs.read(path)` | Read text file → `{ content }` |
| `fs.write(path, content)` | Write text file |
| `fs.delete(path)` | Delete file or directory |
| `fs.mkdir(path)` | Create directory (including parents) |
| `fs.rename(from, to)` | Rename or move file/directory |

### mvmOS.onResources(fn)

Subscribe to system resources (polled every 3s). Use in widgets instead of making separate requests.

```js
mvmOS.onResources(data => { /* data.cpu_pct, data.mem_used, ... */ });
```

### mvmOS.widgetSetting(id, key, default?)

Read a widget setting from localStorage.

### mvmOS.widgetDb(widgetId)

DB object for a widget — same interface as `mvmOS.db()`.

### mvmOS.initMobileSidebar(body)

Adds a ☰ button on mobile if `body` contains an element with class `.as-sidebar`. No-op on desktop.

### mvmOS.openSettings(tab?)

Opens system settings. Tabs: `'apps'`, `'about'`, `'widgets'`, `'themes'`.

---

## App Backends (backend/apps/)

- File path: `backend/apps/<app-id>/backend.py`
- Loaded dynamically at startup by `app_backends.load_all()`
- On install: `app_backends.install(app_id, source_code)`
- On uninstall: `app_backends.uninstall(app_id)`
- Install/update/uninstall take effect **immediately, no restart needed**: routes are
  re-mounted at runtime and repositioned before the catch-all `/` static mount
  (`reposition_before_mounts()`), and the source is exec'd directly (bypasses stale
  `.pyc` caches). Same applies to `public_loader` (`public.py` → `/pub/<app-id>/`).
- Must define a `router = APIRouter(...)` at module level
- All endpoints must require `session=Depends(get_current_session)`
- Only `backend.py` is installed — no other Python files are allowed
- **Shell commands must run as the session's `effective_user`** (see Privilege Model) — never as the root uvicorn process

```python
import sys
from fastapi import APIRouter, Depends
get_current_session = sys.modules["backend.auth"].get_current_session
router = APIRouter(prefix="/api/my-app", tags=["my-app"])
```

---

## db.json Schema

On install/update, `_apply_schema()` in `plugins.py` automatically:
- Creates new tables
- Adds new columns (`ALTER TABLE ADD COLUMN`)
- Removed columns are ignored — data stays, just unused

```json
{
  "tables": [
    {
      "name": "cfg",
      "columns": [
        { "name": "key",   "type": "TEXT", "primary": true },
        { "name": "value", "type": "TEXT" }
      ]
    }
  ]
}
```

---

## Versioning

- Core version: `version.txt`
- On release: bump `version.txt` + commit with changelog in body
- App version must match in: app `manifest.json`, category `manifest.json`, and comment in `main.js`
- `min_core_version` in app manifest blocks install on incompatible systems

---

## Servers

| Server | Port | Service | Directory |
|--------|------|---------|-----------|
| Production | 8080 | `mvmos` | `/opt/mvmos` |
| Dev | 8081 | `mvmos-dev` | `/var/www/mvmos.mvmrik.com` |

- Restart dev: `sudo systemctl restart mvmos-dev`
- Update production: `git pull` + `systemctl restart mvmos` on target machine
- Service runs as `mvmos` user (production) / `root` (dev)

---

## Store (mvmos-store)

```
/var/www/mvmos-store/
  manifest.json           — root manifest with categories
  apps/
    <category>/
      manifest.json       — list of apps in this category
      <app-id>/
        manifest.json
        main.js
        style.css
        db.json
        backend.py
  widgets/
    <category>/
      manifest.json
      <widget-id>/
        manifest.json
        main.js
        style.css
  themes/
    <theme-id>/
      manifest.json
      theme.css
  DEVELOPER.md            — developer documentation
```

- `base_url` in manifests points to the raw GitHub URL of the app folder

## Game Hub Integration

Game Hub (`apps/gamehub`) is an optional app that provides player profiles, session history, leaderboards, multiplayer invitations, and a public-facing page. Games integrate with it voluntarily — if Game Hub is not installed, games must work normally without it.

### Widget API (`/apps/gamehub/widget.js`)

Load the widget dynamically and use the `window.GameHub` API:

```javascript
function _loadGameHub(cb, errCb) {
  if (window.GameHub) { window.GameHub.init().then(cb); return; }
  const s = document.createElement('script');
  s.src = '/apps/gamehub/widget.js';
  s.onload  = () => window.GameHub?.init().then(cb) || cb();
  s.onerror = errCb || cb;  // always unlock UI even if GH not installed
  document.head.appendChild(s);
}
```

Available methods on `window.GameHub`:

| Method | Returns | Description |
|---|---|---|
| `init()` | `Promise` | Restore session from localStorage, returns resolved when done |
| `isLoggedIn()` | `bool` | Whether a player is logged in |
| `currentPlayer()` | `{id, username, display_name, avatar_color}` or `null` | Logged-in player info (sync) |
| `getToken()` | `string` or `null` | Raw GH token for manual API calls |
| `renderWidget(container, opts)` | — | Render login/profile widget with optional Ready button |
| `recordSession(data)` | `Promise<Response>` | Record a completed game session |
| `logout()` | `Promise` | Log out the current player |

### Recording a session

Call after the game ends. All player fields are optional — include only those you have:

```javascript
window.GameHub.recordSession({
  game_id:          'mygame',          // must match the app id in plugins table
  mode:             'singleplayer',    // or 'multiplayer'
  duration_seconds: 120,               // total game time
  metadata:         { rounds: 5, time_per_round: 30 },  // any extra data
  players: [
    {
      player_id: 'abc123',   // GH player id — null for guests
      guest_name: null,      // display name for guests without a GH account
      score:    4200,
      rank:     1,
      is_winner: true,
    },
    {
      player_id: null,
      guest_name: 'Guest',
      score:    1800,
      rank:     2,
      is_winner: false,
    },
  ],
});
```

## Multiplayer Framework (Game Hub)

**Multiplayer is hosted entirely by the Game Hub.** A game never writes its own
WebSocket server, room manager, reconnect logic, lobby or invite flow — it
provides ONLY its game logic. The hub owns everything generic; the hub knows
nothing about any specific game.

```
Game Hub (backend/apps/gamehub/mp.py + widget.js GameHub.mp)
  rooms · sockets · player identity (GH token) · reconnect · roster
  lobby UI · invites · start/finish · session recording · generic play page
        ▲ contract
        │
Game (backend/apps/<id>/mp_game.py  +  apps/<id>/mp.js)
  rounds · moves · scoring · win conditions — nothing else
```

Single-player stays inside the app in mvmOS as before; only multiplayer goes
through the hub. The game's in-mvmOS "Multiplayer" button simply opens the
public hub (`window.open('/apps/gamehub/public/')`).

### Discovery (no hardcoded game list)

The hub lists a game as multiplayer-capable **iff** `backend/apps/<id>/mp_game.py`
exists. Name/icon come from the plugins table; `max_players` from the game's
`manifest.json`. There is no per-game code anywhere in the hub.

### Server contract — `backend/apps/<id>/mp_game.py`

Expose a class `Game(ctx)`. The hub instantiates it when the host presses Start.
All callbacks are async:

| Callback | When |
|---|---|
| `on_start(settings)` | host started — initialise game state from opaque `settings` |
| `on_join(player)` | a player connected or **reconnected** — send them current state |
| `on_leave(player)` | a player disconnected |
| `on_message(player, msg)` | a move/action from a player (the game logic) |

`ctx` (the hub API the game calls back into):

| Member | Purpose |
|---|---|
| `ctx.settings` | opaque settings dict from room creation (hub never reads it) |
| `ctx.room_id` / `ctx.host_id` | identifiers |
| `ctx.players()` | connected roster entries `{id, display_name, avatar_svg, avatar_color, slot}` |
| `ctx.all_players()` | full roster incl. disconnected |
| `await ctx.broadcast(msg, exclude=None)` | send to all (or all but one) |
| `await ctx.send(player_id, msg)` | send to one |
| `ctx.schedule(delay, coro_factory)` | run an async fn after `delay` s (e.g. round timer) |
| `await ctx.finish(records, metadata=…)` | end game → writes `game_sessions` → broadcasts `game_over` |

`records` for `ctx.finish` is a list of `{player_id, score, rank, is_winner, guest_name?}`.
The hub writes the session — **the game never calls `/session` itself in multiplayer.**

Player identity and avatars come from the GH token at connect time; the game
does **not** read the Game Hub database.

### Client contract — `apps/<id>/mp.js`

Loaded by the hub's generic play page alongside `widget.js`. Register once at
load:

```javascript
window.GameHub.mp.registerGame({
  id: 'mygame',
  name: 'My Game',
  renderSetup(box, settings) {   // host-only lobby settings form
    box.innerHTML = '…';
    return function collect() { return { /* opaque settings */ }; };  // or null to block start
  },
  renderGame(root) {             // builds the in-game UI; takes over `root`
    // use GameHub.mp.on(...) handlers (registered at load) to drive it
  },
});
```

`window.GameHub.mp` API for the game:

| Member | Purpose |
|---|---|
| `mp.on(type, cb)` | subscribe to a game message type (register at load) |
| `mp.send(msg)` | send a move to the server |
| `mp.players()` / `mp.me()` / `mp.youId()` | roster / self |
| `mp.isHost()` / `mp.hostId()` | host checks |
| `mp.settings()` / `mp.roomId()` / `mp.gameId()` | room info |
| `mp.renderAvatar(player, size)` | SVG avatar |

The hub handles the socket, join/auth, **reconnect** (the GH token is the slot
key — reconnecting reclaims the same slot and `on_join` resends state),
heartbeat, the lobby (roster + invites + Start button), and switching to the
in-game view on start.

### How to make a game multiplayer (3 steps)

1. `backend/apps/<id>/mp_game.py` — a `Game` class with the callbacks above.
2. `apps/<id>/mp.js` — `registerGame({id, name, renderSetup, renderGame})` + `mp.on/mp.send`.
3. `apps/<id>/manifest.json` — add `"multiplayer": true` and `"max_players": N`.

That's all. The hub discovers it, lists it on the public page, creates rooms,
connects players, manages reconnect, and records results. Reference
implementation: **FindYourself** (`backend/apps/findyourself/mp_game.py`,
`apps/findyourself/mp.js`).

### Multiplayer endpoints (all under `/api/pub/gamehub/mp/`)

| Method | Path | Description |
|---|---|---|
| POST | `/rooms` | create a room `{game_id, settings?}` → `{room_id, play_url}` |
| GET | `/rooms?game_id=` | open lobbies for a game |
| GET | `/games` | multiplayer-capable games (discovered via `mp_game.py`) |
| POST | `/rooms/{id}/start` | host starts `{settings}` |
| GET | `/play/{id}` | generic play page (loads `widget.js` + the game's `mp.js`) |
| WS | `/rooms/{id}/ws` | join with `{type:'join', gh_token}`; hub assigns/reclaims slot |

Invites reuse the existing `/api/pub/gamehub/invite` table (room_url =
`/api/pub/gamehub/mp/play/{room_id}`); the hub lobby sends them automatically.

### Public endpoints (no mvmOS session required)

All endpoints are under `/api/pub/gamehub/`. The caller passes `X-GH-Token: <token>` for authenticated actions.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/pub/gamehub/config` | — | `{public, allow_registrations}` hub settings |
| POST | `/api/pub/gamehub/login` | — | Login, returns `{token, player}` |
| POST | `/api/pub/gamehub/register` | — | Register, returns `{token, player}` |
| POST | `/api/pub/gamehub/logout` | token | Invalidate token |
| GET | `/api/pub/gamehub/me` | token | Current player info |
| PUT | `/api/pub/gamehub/me` | token | Update display_name / password |
| GET | `/api/pub/gamehub/stats` | — | Full stats: games, leaderboard, recent sessions, players |
| POST | `/api/pub/gamehub/session` | — | Record a session (token not required — game sends it) |
| POST | `/api/pub/gamehub/invite` | token | Send invitations to GH players |
| GET | `/api/pub/gamehub/invites` | token | List pending invitations for the logged-in player |
| DELETE | `/api/pub/gamehub/invites/{id}` | token | Dismiss an invitation (recipient) |
| DELETE | `/api/pub/gamehub/invites?room_url=…` | token | Cancel all invites sent for a room (host) |

### Checklist — single-player Game Hub support

1. Use `_loadGameHub(cb, errCb)` — `errCb` must unlock any locked UI so the game works without GH
2. Use `window.GameHub.renderWidget()` on the setup screen for login/profile
3. Call `recordSession({mode:'singleplayer', …})` once per finished game
4. Use `game_id` that exactly matches the app's `id` in the plugins DB — this links sessions to the game's name and icon

### Checklist — multiplayer

Do **not** write any of the multiplayer plumbing yourself. Follow the
**Multiplayer Framework** section above:

1. `backend/apps/<id>/mp_game.py` with a `Game` class (game logic only)
2. `apps/<id>/mp.js` calling `GameHub.mp.registerGame(...)` (UI + `mp.on`/`mp.send`)
3. `manifest.json`: `"multiplayer": true`, `"max_players": N`
4. The in-mvmOS Multiplayer button just opens `/apps/gamehub/public/`

The hub records the session via `ctx.finish(records)` — the game must **not**
call `recordSession()` in multiplayer.
