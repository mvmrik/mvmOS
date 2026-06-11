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

### Multiplayer lobby — GH widget for join screen

Use `window.GameHub.renderWidget(container, opts)` on join screens that need a Ready button. Use the compact `_renderGhSection` pattern (show who is logged in, no Ready button) on host setup screens.

```javascript
// Join screen — shows login/profile + Ready button
window.GameHub.renderWidget(container, {
  onReady: (player) => {
    // player is null if joining as guest
    connectToRoom(player);
  },
  onGuest: (name) => connectToRoom(null, name),
});
```

### Sending multiplayer invitations

Favourites are stored per-player in localStorage under the key `gh_favs_<player_id>` as a JSON array:

```json
[
  { "id": "abc123", "username": "martin", "display_name": "Martin", "avatar_color": "#89b4fa" }
]
```

In the host lobby, after creating a room, you can invite Game Hub favourites:

```javascript
const me = window.GameHub.currentPlayer();
if (me) {
  const favs = JSON.parse(localStorage.getItem('gh_favs_' + me.id) || '[]');
  // show checkboxes for each fav, then:
  await fetch('/api/pub/gamehub/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() },
    body: JSON.stringify({
      to_ids:   ['player-id-1', 'player-id-2'],  // selected fav ids
      game_id:  'mygame',
      room_url: link,   // the room join URL from mvmOS.multiplayer.createRoom()
    }),
  });
}
```

Invitations expire after 2 hours. Recipients see them in Game Hub → Games tab with a 🔔 badge and a "Join ▶" button. Dismissing removes the invite from the DB.

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

### Checklist for adding Game Hub support to a new game

1. Use `_loadGameHub(cb, errCb)` — `errCb` must unlock any locked UI so the game works without GH
2. Use `window.GameHub.renderWidget()` on join screens; use compact profile display on host setup screens
3. Call `recordSession()` once per completed game — host-only in multiplayer (use a `sessionRecorded` flag to avoid duplicates)
4. Pass `gh_player_id` through the multiplayer hello protocol so the host has it when recording the session
5. Use `game_id` that exactly matches the app's `id` in the plugins DB — this is what links sessions to the game's name and icon in Game Hub
6. In the host lobby, if `currentPlayer()` is not null, read `gh_favs_<id>` from localStorage and show the invite UI; skip silently if no favourites
