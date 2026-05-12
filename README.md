# VirtualOS

A browser-based virtual desktop for headless Linux servers. No Node.js, no build step — just Python + vanilla JS.

## Quick Install

```bash
git clone <repo>
cd virtualos
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

# Create config.ini first (see config.example.ini)
cp config.example.ini config.ini
# Edit config.ini and set a real password hash:
python3 -c "from passlib.hash import bcrypt; print(bcrypt.hash('yourpassword'))"

# Run
uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload
```

## Project Structure

```
virtualos/
  backend/
    main.py        FastAPI app, mounts static files, includes routers
    auth.py        Login/logout, session management (SQLite + bcrypt)
    terminal.py    WebSocket PTY handler (ptyprocess)
    files.py       File manager REST API
    desktop.py     Desktop state persistence API
    db.py          SQLite init and helpers
  frontend/
    index.html     Desktop shell
    desktop.js     Window manager, drag-and-drop, context menu
    terminal.js    xterm.js terminal window
    filemanager.js File manager UI
    style.css      Dark OS theme
  install.sh
  config.example.ini
```

## Features

- **Real terminal** — WebSocket PTY, full color, interactive programs (vim, htop, nano)
- **Multiple terminal windows** — each gets its own PTY session
- **File manager** — browse, upload, rename, delete, create folders
- **Draggable windows** — move, resize, minimize, maximize, close
- **Icon positions saved** — persisted in SQLite
- **Start menu** — taskbar launcher
- **Dark theme** — minimal OS aesthetic

## Security Notes

- All file manager paths are validated against `$HOME` to prevent path traversal
- Sessions are stored as random 64-char hex tokens in SQLite
- Password is stored as a bcrypt hash — never in plaintext
- Session cookie is `HttpOnly` and `SameSite=lax`
- Place behind nginx or Cloudflare Tunnel for HTTPS in production

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | HTTP + WebSocket framework |
| `uvicorn[standard]` | ASGI server (includes websockets) |
| `ptyprocess` | Spawn and manage PTY processes |
| `passlib[bcrypt]` | Password hashing |

xterm.js and xterm-addon-fit are loaded from CDN — no npm required.

## Service Management

```bash
sudo systemctl status  virtualos
sudo systemctl restart virtualos
sudo systemctl stop    virtualos
journalctl -u virtualos -f
```
