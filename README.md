# mvmOS

A browser-based virtual Linux desktop for headless servers. Run it on any Linux machine and access a full desktop environment from your browser — no GUI, no VNC, no Node.js, no build step. Just Python + vanilla JS.

Designed to make working on servers without a graphical interface much easier.

## What's included

- **Full terminal** — real WebSocket PTY, full color, supports any interactive program (vim, htop, nano...)
- **Full file manager** — browse, upload, rename, delete, copy/paste, search
- **Desktop** — icons, shortcuts, drag-and-drop, multi-select
- **Linux user support** — file operations run as real system users
- **Package manager** — install and remove real Linux packages (APT) from thousands of available programs
- **Settings** — persistent preferences per user

## Apps, Widgets & Themes

The core OS is intentionally minimal. Additional apps, widgets and themes are installed from a store — either the official [mvmos-store](https://github.com/mvmrik/mvmos-store) or any custom store repository you point it to.

Anyone can create their own apps, widgets and themes. See the [mvmos-store developer guide](https://github.com/mvmrik/mvmos-store) for full documentation.

## Install

**With git:**
```bash
git clone https://github.com/mvmrik/mvmOS.git
cd mvmOS
bash install.sh
```

**Without git:**
```bash
curl -fsSL https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz | tar -xz
cd mvmOS-main
bash install.sh
```

The installer will ask for a port (default `2026`), set up a Python virtualenv and create a systemd service. Run as root or with `sudo`.

## Manual update (terminal)

If you can't access the UI, update from the terminal:

```bash
cd /opt/mvmos && sudo curl -fsSL https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz | sudo tar -xz --strip-components=1 --exclude='.git' --exclude='venv' --exclude='backend/apps' --exclude='data.db' --exclude='config.ini' -C /opt/mvmos && sudo systemctl restart mvmos
```

## Uninstall

```bash
sudo systemctl disable --now mvmos 2>/dev/null || true; sudo rm -f /etc/systemd/system/mvmos.service; sudo systemctl daemon-reload; sudo rm -rf /opt/mvmos
```

> **Note:** This removes everything including installed apps, desktop configuration and all user data. Your Linux system users are not affected.

## Requirements

- Python 3.10+
- Linux with systemd (Ubuntu, Debian, Fedora, Arch, openSUSE and others)

For remote access over the internet, put it behind **nginx + HTTPS** or use a **Cloudflare Tunnel** — both work fine. For local use, no proxy needed.

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | HTTP + WebSocket framework |
| `uvicorn[standard]` | ASGI server |
| `ptyprocess` | Terminal PTY |
| `python-multipart` | Form parsing |
| `httpx` | HTTP client |
| `watchdog` | File system events |
| `python-pam` | Linux password authentication |

No npm, no build step. xterm.js is bundled locally.

## Disclaimer

mvmOS is open-source software provided "as-is" without any warranty, express or implied. The authors are not liable for any damage to your system, data loss, security breaches, or any other issues that may arise from its use. You are solely responsible for securing your own server and data. Use at your own risk.
