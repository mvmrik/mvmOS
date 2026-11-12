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
installing software without touching the command line. File Manager can also connect folders
shared by another mvmOS server, with revocable invitations and separate permissions.
Browse and transfer files directly between your browser and the source server,
including copying whole folders between local and remote storage. These are virtual
File Manager locations, not Linux mounts or automatic app file-picker entries.
See the [File Manager guide](docs/core-apps/file-manager.md#shared-folders-between-servers).
The Devices place lists extra and external disks, which an administrator can mount and eject
without leaving File Manager. See the [File Manager guide](docs/core-apps/file-manager.md#disks-and-external-drives).

**Run the machine.** Manage Linux users, cron jobs, systemd services, nginx sites and
domains, SSH keys, and scheduled backups you can download or restore. Watch CPU, memory and
disk while you do it. System changes require administrator rights checked by the server;
sudo users confirm their own password, with a key valid for fifteen minutes without use.

**Make it yours.** Wallpapers, themes, a screensaver, desktop and taskbar widgets, a
configurable start menu, default apps for every file type, and an interface in nine
languages: English, Bulgarian, German, Spanish, French, Japanese, Brazilian Portuguese,
Russian and Simplified Chinese. It installs as a PWA, so it can sit on your phone's home
screen and behave like an app.

**Let it work on its own.** Notifications and a shared Clipboard come built in, and
Automations lets your apps act by themselves: when something happens in an app, or at a
chosen time, a rule can check what the app reports and call its functions or notify you.
External APIs let your own scripts call the functions you choose, with tokens you can
restrict and revoke.

**Add what you need.** The core stays deliberately small. Everything else — a budget tracker,
a task list, a website builder, a chat, an RSS reader, games, an AI assistant, a database
client, a torrent dashboard — installs from the App Store in a couple of clicks, and
uninstalls just as cleanly.

**Share it outside the server.** Many apps can publish a public page: a booking form, a
shared shopping list, a quote for a client. Visitors get their own lightweight account
through Apps Hub and never touch your Linux users or your desktop. The mvmOS Apps browser
extension for Chrome and Firefox brings those public apps into the browser toolbar. The
public header lets visitors switch directly between their apps, and a closed Community feed lets profiles of the same server share posts, photos and what they did in an app with everyone, their favourites or chosen people.

Public apps can opt into access checks per Apps Hub profile with `public_profile_access: true` and their own private `_can_access_public(user_id)` hook in `app_api.py`. Core filters discovery; ownership, sharing roles and route authorization remain in the app. See [Apps Hub documentation](docs/core-apps/apps-hub.md#profile-specific-app-visibility) and the Store developer guide for the contract.

An app that needs a key for an outside service (`google_maps` and `simkl`) names it in its manifest with `"services": ["google_maps"]` instead of a key setting, and its server code asks `hub.resolve_service_key(user_id, "google_maps", "<app id>")`. For services allowing personal keys, the profile's own keys (Apps Hub → Settings → Service keys: any number, each for all apps or only for ticked apps; a key limited to the app comes first, then a general one) win; otherwise the first of the administrator's keys that is valid for that app and covers that profile is used (desktop Apps Hub → Service keys: any number of named keys, each with its apps and, per app, all or selected people). Administrators cannot read profiles' own keys. See [Apps Hub documentation](docs/core-apps/apps-hub.md#service-keys-for-outside-services).

Simkl support starts with Core 1.22.0. Its client ID is administrator managed and shared with selected profiles; it is not offered among personal service keys. The administrator form shows the installation origin to register as the service return address.

Apps registered with `requires_apphub: true` show the signed-in profile in desktop window title bars. Its menu opens the account, the app’s settings when present, or logout.

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

The official store is a plain Git repository, so you can point mvmOS at your own store
instead, or in addition — private apps for your own machines work exactly like public ones.

Apps can supply their own picture icon through `icon_image` in `manifest.json`; mvmOS
1.16.0 shows it across the desktop and Apps Hub, with the emoji kept as a fallback.

Writing an app takes a `manifest.json` and one JavaScript file. Apps run sandboxed: an app
can read and write its own folder and nothing else, and anything beyond that goes through a
small, explicit platform API. Full documentation lives in the
[mvmos-store developer guide](https://github.com/mvmrik/mvmos-store).

mvmOS itself is free. An optional Premium licence for the server adds extra features to
some apps and a few to the core, such as Apps Hub credits, External APIs and Automations
that work across apps. It is entirely opt-in: every app and every core feature without
the Premium label works fully without it.

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

## For developers: naming files with asset()

Never write a bare path to a script, stylesheet, image, font or data file that a browser
loads. Always pass it through `asset()`, which returns the URL with `?v=<time the file last
changed>`, so a changed file gets a new address and no cache (browser, Electron, Cloudflare)
can serve an old copy.

- In the browser: `window.asset('/pub/apphub/layout.js')`. It is defined by `frontend/asset.js`
  and fed with `window.__assets`, which the server writes into desktop and public app pages.
- In Python: `from backend.assets import asset`. It is the same function and works for core
  files, `/apps/<id>/...`, `/pub/<id>/...`, `/widgets` and `/themes`.
- In the main page `index.html` every local `src` and `href` is passed through it
  automatically, so write the plain path there and never a hand-made `?v=`.

It is being adopted step by step: use it in everything new, and replace the old `Date.now()`,
hand-made `?v=` numbers and bare paths with it whenever you touch that code.


---

## For developers: shared file picker and uploader

Core loads `mvmOS.filePicker` (`frontend/file-picker.js`) and `mvmOS.uploader`
(`frontend/uploader.js`) on the desktop and on public app pages. The picker only
lets a person choose; the uploader sends. Neither is a security boundary: the app's
backend must check every path again with `backend/filepicker.py`
(`resolve_server_path`, `copy_server_file`, `read_server_chunks`, `shared_file_url`).

```js
await mvmOS.filePicker.ready();
const r = await mvmOS.filePicker.open({
  mode: 'files',                       // 'file' | 'files' | 'folder' | 'directory' (a place to save to)
  sources: ['device', 'server', 'shared'],
  accept: ['.mp3', 'audio/*'],
  server: { roots: ['~'], start: '~/Music' },   // the person cannot leave the roots
  shared: { ids: null, permission: 'read' },     // 'upload' to choose where to write
});                                             // null when cancelled
```

It first asks where the files are (this device, the mvmOS server as the signed-in
Linux user, or a folder shared from another mvmOS) and offers only the sources the
app allows and the person can reach. A start folder that no longer exists opens the
root instead. A file from a shared folder is not copied: `sharedFileUrl` signs a
short link and the bytes flow from the sharing server.

Core 1.22.0 adds **New folder** when choosing a folder or save destination. Set `createFolder: false` to disable it; shared destinations offer it only with upload permission. A newly created save destination is selected immediately.

For libraries that keep files in place, `backend.filepicker` also supplies `folder_files`, `open_server_file`, `write_beside`, `shared_folder_files`, `shared_read_head`, `shared_can_write` and `shared_write_beside`. Resolve the chosen root first, retain the Linux owner with the source and close returned file handles. Server reads enforce the owner’s access and the root boundary. Shared playback uses `shared_file_url` directly from the source server. These helpers require Core 1.22.0. Core 1.22.1 makes every request to a shared folder carry its own `mvmOS-shared-files` User-Agent, so a sharing server behind Cloudflare no longer refuses the default Python client. Core 1.23.0 makes files and folders written into a shared folder 644 and 755 instead of private 600, so a media server on the sharing machine can read them, and adds `shared_mkdir(owner, folder_id, path)`, `shared_delete(owner, folder_id, path)` and `shared_upload_file(owner, folder_id, path, local_path)` for writing to a shared folder from an app. Core 1.23.0 also lets System backups go to several places, each with its own schedule and number of copies to keep.

```js
const job = await mvmOS.uploader.choose({
  mode: 'files',                       // or 'folder'
  accept: ['.torrent'],
  destination: { sources: ['server', 'shared'], server: { roots: ['~'], start: '~' }, rememberKey: 'my-app' },
  extract: false,                      // unpack .zip/.tar archives on arrival (server only)
});
mvmOS.uploader.upload({ files, destination: { type: 'server', path: '/home/me/x' } });
// or { type: 'shared', folderId, path: 'Albums', name: 'Music' }
```

Uploads are cut into parts under Cloudflare's request limit, run one after another
and show in one floating panel with progress, speed, Stop and Try again. A server
upload goes through `/api/files/upload-chunk` as the Linux user of the session, so
it can write no more than File Manager could. A shared-folder upload goes straight
from the browser to the sharing server. A job handle has `cancel()`, `retry()` and
`state`, and the callbacks `onDone`, `onError` and `onCancel` receive it.
`mvmOS.upload` remains for existing apps.

---

## For developers: regional date and time picker

`mvmOS.dateTimePicker` is loaded by Core on the desktop and public app HTML pages.
Use `create(host, options)` instead of native date/time fields when a control must
follow mvmOS regional settings. It does not automatically alter other inputs.

```js
const picker = mvmOS.dateTimePicker;
await picker.ready();
const field = picker.create(host, {
  type: 'datetime', // 'date', 'time', or 'datetime'
  name: 'departure',
  label: t('departure'),
  required: true,
  value: picker.fromEpoch(departureSeconds),
  onChange(value) { /* canonical wall time, e.g. 2026-10-29T15:07 */ },
});
const departure = picker.toEpoch(field.value); // seconds, or null if invalid
field.destroy(); // remove control, any open dialog and event listeners
```

Use `createRange(host, options)` for an inclusive date period selected in one calendar:

```js
const period = picker.createRange(host, {
  label: t('period'), required: true,
  value: { from: '2026-04-01', to: '2026-10-31' },
  onChange(value) { /* a copy of {from, to}, in canonical date format */ },
});
const season = picker.createRange(seasonHost, {
  label: t('annual_season'), required: true, annual: true,
  value: { from: '11-01', to: '03-31' },
});
period.destroy();
season.destroy();
```

Ranges expose the same handle methods as individual controls. Their `value` is
`{from, to}`; the hidden named `input` contains its JSON representation, or an
empty string when cleared. Both endpoints must be present for a required range.
Normal endpoints use `YYYY-MM-DD` and require `from <= to`. With `annual: true`,
endpoints use `MM-DD`, omit the year in the calendar and display, support
February 29, and may cross New Year (`from > to`). Annual dates are recurring
month/day values, not instants: do not convert them to epoch timestamps.
`min`/`max`, when supplied, constrain each endpoint in the same canonical format.
Changes are committed only with Apply; Cancel and Escape keep the original value.
The start and end buttons let the user edit either endpoint; arrows move calendar
focus, and Enter/Space select a date. Destroy handles when their view closes.

Use `formatRange({from, to}, options)` for regional range text and
`formatAnnual('MM-DD', options)` for a recurring date without a year. These use
the configured day/month order, including day first for a DD/MM/YYYY preference.
The range component has no app-specific or billing rules; callers decide how an
inclusive date period maps to their API or storage boundaries.

`value`, `min` and `max` use `YYYY-MM-DD`, `HH:mm` or `YYYY-MM-DDTHH:mm` according
to `type`. The returned handle provides `value`, `setValue(value)`, `validate()`,
`open()`, `button` and the hidden canonical form `input`. Optional fields support
clearing. `lang` controls localized calendar names and 12-hour day periods;
`labels` can override the active Core UI labels. Explicit `dateFormat`,
`timeFormat`, `weekStarts` and `timeZone` override regional defaults. Otherwise
Core reads `/api/settings/display`, the public profile's date/time preferences
when applicable, and the desktop's current settings. Defaults are refreshed from
desktop settings events; a language change refreshes existing controls.

`format(value, options)`, `fromEpoch(seconds, options)` and `toEpoch(value, options)`
use the same regional rules; conversion options accept `type` and `timeZone` too.
Date and datetime conversion reject invalid dates. Nonexistent local times during
the spring DST transition return `null`; repeated autumn times select the first
occurrence. Time-only values represent a wall clock and cannot be converted to an
epoch without a date. Preserve an existing epoch when its minute value is unchanged
if exact seconds or the second occurrence of a repeated local minute must be kept.

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

## Theme contrast

Core derives `--on-accent` from the active `--accent` color, choosing black or white for the stronger contrast and refreshing it when the theme changes. Use it for text and icons on an accent background. Public Apps Hub pages get `--pub-on-accent` (and `--on-accent`) the same way from `frontend/accent-contrast.js`, refreshed whenever the profile theme changes. The desktop background may be a wallpaper color and must not be used as contrasting text. Theme-aware panels use `--text`/`--text-dim` with `--surface`/`--surface2`; public apps use the corresponding `--pub-*` variables. Fixed dark canvases, game boards and media viewers must set their own light foreground, including overlays and secondary labels. Check result dialogs, bonus breakdowns, status messages, selected states and hover states in light and dark themes when changing an interface.
