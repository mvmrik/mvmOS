# mvmOS

A browser-based virtual desktop for headless Linux servers. No Node.js, no build step — just Python + vanilla JS.

**Current version:** 0.3.3-beta

---

## Quick Install

```bash
git clone <repo>
cd mvmos.mvmrik.com
chmod +x install.sh
./install.sh
```

The installer will:
- Ask for a port (default `8080`) and admin username
- Generate a random password (or let you set one)
- Create a Python virtualenv and install dependencies
- Write `config.ini` with hashed credentials
- Create and enable a `systemd` service

## Manual / Development Start

```bash
python3 -m venv venv
source venv/bin/activate
pip install fastapi "uvicorn[standard]" ptyprocess "passlib[bcrypt]"

cp config.example.ini config.ini
# Set a password hash:
python3 -c "from passlib.hash import bcrypt; print(bcrypt.hash('yourpassword'))"

uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload
```

## Project Structure

```
mvmos.mvmrik.com/
  backend/
    main.py        FastAPI app, auth middleware, static mounts
    auth.py        Login/logout, session management (SQLite + bcrypt)
    terminal.py    WebSocket PTY handler (ptyprocess)
    files.py       File manager REST API
    desktop.py     Desktop icon positions and app shortcuts
    system.py      System info, resources, processes, services
    plugins.py     App Store — install/remove/update apps
    widgets.py     Widget Store — install/remove/reposition widgets
    themes.py      Theme Store — install/activate themes
    users.py       User management (add, remove, switch user)
    packages.py    APT package manager API
    settings.py    OS settings persistence
    db.py          SQLite init, helpers, directory paths
  frontend/
    index.html     Desktop shell
    mvmos.js       Plugin/widget API, window manager, notifications
    desktop.js     Desktop icons, multi-select, drag, context menu
    filemanager.js File manager — browse, upload, copy/paste, search
    terminal.js    xterm.js terminal window
    appstore.js    App Store UI
    widgetstore.js Widget Store UI
    mediaviewer.js Image viewer and media player
    settings.js    Settings UI
    style.css      Theme-aware OS stylesheet
    lib/
      xterm.js            (bundled locally)
      xterm-addon-fit.js
  version.txt      Current version string
  install.sh
  config.example.ini
```

External apps and widgets live in a separate repository (mvmos-store), served as static files.

## Features

- **Real terminal** — WebSocket PTY, full color, interactive programs (vim, htop, nano)
- **Multiple terminal windows** — each gets its own PTY session
- **File manager** — browse, upload (including folders via drag-and-drop), rename, delete, copy/paste, create folders, search, image preview sidebar, file info
- **Upload progress** — real-time progress bar, 2 GB limit
- **Multi-select** — Ctrl+click, Shift+click, Ctrl+A in file manager and on desktop
- **Draggable windows** — move, resize, minimize, maximize, close
- **Desktop** — icons, multi-select, copy/paste, app shortcuts, URL shortcuts, folder shortcuts
- **Desktop widgets** — draggable, resizable, position saved per user; hover to reveal titlebar and close button
- **App Store** — install apps from store repositories
- **Widget Store** — install desktop/taskbar widgets
- **Theme Store** — install and switch themes at runtime
- **Themes** — full CSS variable system; themes adapt windows, panels, widgets
- **System monitor** — CPU, RAM, disk, processes, services (via System Info app)
- **User switching** — run file operations as a different system user
- **Notifications** — OS-level notification panel in taskbar
- **Settings** — persistent OS preferences per user

## Security Notes

- Session tokens are random 64-char hex strings stored in SQLite
- Password is stored as a bcrypt hash — never in plaintext
- Session cookie is `HttpOnly` and `SameSite=lax`
- All file paths are validated with `os.path.realpath()` before use
- `redirect_slashes=False` on FastAPI to prevent redirect-based upload bypasses
- Place behind nginx with HTTPS in production (example config in repo)

## nginx

A sample nginx config is included. Key settings:

```nginx
client_max_body_size 2048m;   # allows up to 2 GB uploads

proxy_read_timeout 300s;
proxy_send_timeout 300s;

proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";  # required for WebSocket terminal
```

## Service Management

```bash
sudo systemctl status  mvmos
sudo systemctl restart mvmos
sudo systemctl stop    mvmos
journalctl -u mvmos -f
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | HTTP + WebSocket framework |
| `uvicorn[standard]` | ASGI server (includes websockets) |
| `ptyprocess` | Spawn and manage PTY processes |
| `passlib[bcrypt]` | Password hashing |

xterm.js and xterm-addon-fit are bundled locally in `frontend/lib/` — no CDN or npm required.
