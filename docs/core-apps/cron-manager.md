---
title: Cron Manager
category: Core apps
category_slug: core-apps
slug: cron-manager
order: 190
---
## Purpose

Cron Manager edits the server's crontab and controls the mvmOS Scheduler — the internal tick that drives apps' own scheduled work — from the desktop, without touching a terminal.

## Capabilities

- View, add, edit, delete, enable, and disable cron jobs for your own account or, with sudo confirmation, another system user.
- Use a shortcut schedule (`@reboot`, `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`) or the five custom fields (minute, hour, day, month, weekday).
- Run any job immediately and see its output and exit code without waiting for its schedule.
- See read-only system jobs from `/etc/cron.d/`, including which installed apps registered a scheduler and whether their backend file is still present.
- Enable or disable the installation's own scheduler tick, which every app's scheduled work depends on.

## Practical tip

Editing another user's crontab, or toggling the installation's scheduler, requires that account's password even for an administrator — this is the same sudo confirmation used elsewhere in mvmOS, not a separate login.
