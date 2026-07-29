# mvmOS

**A full desktop for your server, in a browser tab.**

Most servers have no screen. You reach them over SSH, you remember the commands, and
anything visual — comparing two folders, editing a config, watching a service misbehave —
turns into a chore. VNC and remote desktops solve that by shipping you an entire graphical
Linux, which most servers cannot spare the memory for and most people do not want to install.

mvmOS takes the other route: the desktop lives in your browser, and the server just answers
it. Open a URL, log in with your normal Linux user, and there is a desktop — windows, a
taskbar, a start menu, files you can drag around. Underneath it is the real machine. The
terminal is a real shell. The file manager moves real files, as your real user, with your
real permissions. Install a package and it is actually installed.

It is Python and plain JavaScript. No Node, no build step, no compiling, nothing to keep
running but one small service. It installs in about a minute and idles at almost nothing.

---

## What you can do with it

**Work on the machine.** A real terminal (full colour, so `vim`, `htop`, `nano` and anything
else interactive works properly), a file manager with upload, download, search, copy/paste
and rename, a code editor, an image and video viewer, and an APT package manager for
installing software without touching the command line.

**Run the machine.** Manage Linux users, cron jobs, systemd services, nginx sites and
domains, SSH keys, and scheduled backups you can download or restore. Watch CPU, memory and
disk while you do it.

**Make it yours.** Wallpapers, themes, a screensaver, desktop and taskbar widgets, a
configurable start menu, and an interface in English or Bulgarian. It installs as a PWA, so
it can sit on your phone's home screen and behave like an app.

**Add what you need.** The core stays deliberately small. Everything else — a budget tracker,
a task list, a website builder, a chat, an RSS reader, games, an AI assistant, a database
client, a torrent dashboard — installs from the App Store in a couple of clicks, and
uninstalls just as cleanly.

**Share it outside the server.** Many apps can publish a public page: a booking form, a
shared shopping list, a quote for a client. Visitors get their own lightweight account
through Apps Hub and never touch your Linux users or your desktop.

---

## Who it's for

- Anyone renting a VPS who would rather click than memorise flags.
- People running a home server, a NAS or a Raspberry Pi and wanting one place to see it all.
- Developers who want a scratch desktop next to a project, reachable from any machine.
- Anyone who has to hand a server to someone non-technical and would like them not to be
  staring at a black screen.

If you live in the terminal and love it, you probably do not need this. If you would like a
window instead — this is that.

---

## Apps, widgets and themes

The official store currently offers **27 apps, 5 widgets and 4 themes**, sorted into twelve
categories. It is a plain Git repository, so you can point mvmOS at your own store instead,
or in addition — private apps for your own machines work exactly like public ones.

Writing an app takes a `manifest.json` and one JavaScript file. Apps run sandboxed: an app
can read and write its own folder and nothing else, and anything beyond that goes through a
small, explicit platform API. Full documentation lives in the
[mvmos-store developer guide](https://github.com/mvmrik/mvmos-store).

A few apps also offer optional paid extras. That is entirely opt-in — mvmOS itself is free,
every app works without it, and nothing about the core depends on it.

---

## Install

```bash
curl -fsSL https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz | tar -xz
cd mvmOS-main
bash install.sh
```

Run as root or with `sudo`. The installer asks for a port (default `2026`), creates a Python
virtualenv and sets up a systemd service. Then open `http://your-server-ip:2026` and log in
with a Linux account from that machine.

Updating afterwards is a button in Settings. If the UI is unreachable, from the terminal:

```bash
cd /opt/mvmos && sudo curl -fsSL https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz | sudo tar -xz --strip-components=1 --exclude='.git' --exclude='venv' --exclude='backend/apps' --exclude='data.db' --exclude='config.ini' -C /opt/mvmos && sudo systemctl restart mvmos
```

To remove it completely:

```bash
sudo systemctl disable --now mvmos 2>/dev/null || true; sudo rm -f /etc/systemd/system/mvmos.service; sudo systemctl daemon-reload; sudo rm -rf /opt/mvmos
```

> This deletes everything mvmOS owns — installed apps, desktop settings and app data. Your
> Linux users and their home directories are untouched.

---

## Requirements

- Python 3.10 or newer
- Linux with systemd (Ubuntu, Debian, Fedora, Arch, openSUSE and others)

Eight Python packages, installed automatically: `fastapi`, `uvicorn[standard]`, `ptyprocess`,
`python-multipart`, `httpx`, `watchdog`, `python-pam`, `six`. No npm, no build step —
xterm.js is bundled.

---

## Before you expose it to the internet

mvmOS logs users in with their real Linux passwords and gives them a real terminal, so treat
the URL like SSH. On a local network you can use it as-is. Anywhere else, put it behind
**nginx with HTTPS** or a **Cloudflare Tunnel**, keep the port itself closed to the outside,
and turn on two-factor authentication in Settings.

---

## Status

mvmOS is in beta and moving quickly. It is used daily on real servers, but expect the
occasional rough edge, and read the release notes before updating a machine you care about.
Bug reports and ideas are welcome in [Issues](https://github.com/mvmrik/mvmOS/issues).

---

## Disclaimer

mvmOS is open-source software provided "as-is", without warranty of any kind. The authors are
not liable for damage to your system, data loss, security incidents or anything else arising
from its use. Securing your server and your data is your responsibility.
