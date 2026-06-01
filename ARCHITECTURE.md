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
- Must define a `router = APIRouter(...)` at module level
- All endpoints must require `session=Depends(get_current_session)`
- Only `backend.py` is installed — no other Python files are allowed

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
