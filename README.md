# mvmOS

A browser-based virtual desktop for headless Linux servers. No Node.js, no build step — just Python + vanilla JS.

**Current version:** 0.3.3-beta

## Features

- **Terminal** — real WebSocket PTY, full color, supports vim, htop, nano and any interactive program
- **File manager** — browse, upload (including folders), rename, delete, copy/paste, search, image preview
- **Desktop** — icons, shortcuts, drag-and-drop, multi-select, copy/paste
- **Desktop widgets** — draggable, always-on components (system monitor, CPU graph, and more)
- **App Store** — install apps from store repositories
- **Widget Store** — install desktop and taskbar widgets
- **Theme Store** — switch themes at runtime
- **System monitor** — CPU, RAM, disk, running processes, services
- **User switching** — file operations as any system user
- **Settings** — persistent preferences per user

## Install

```bash
git clone <repo>
cd mvmOS
bash install.sh
```

The installer will ask for a port (default `8080`) and admin username, generate a password, set up a Python virtualenv and create a systemd service.

## Requirements

- Python 3.10+
- Linux with systemd
- nginx (recommended, for HTTPS and a real domain)

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | HTTP + WebSocket framework |
| `uvicorn[standard]` | ASGI server |
| `ptyprocess` | Terminal PTY |
| `passlib[bcrypt]` | Password hashing |

No npm, no build step. xterm.js is bundled locally.

## Apps & Widgets

Apps, widgets and themes are managed through a separate store repository. See [mvmos-store](https://github.com/mvmrik/mvmos-store) for the developer guide on building your own.
