---
title: Settings
category: Core apps
category_slug: core-apps
slug: settings
order: 160
---
## Purpose

Settings collects system-level configuration in one desktop window. Its home screen groups controls by topic and can search settings by name; choose a group to see its related tabs. Apps that register their own settings can also be opened from this area.

## Areas covered

- Display, wallpaper, and screensaver preferences.
- Regional format and language.
- Default apps, which decide the app that opens each file type from File Manager and the desktop, including types added by Store apps.
- Start Menu configuration.
- Backups, SSH access, and local user accounts.
- System information and Core updates.
- The Setup Wizard, which can be reopened after first login to review regional, privacy, app, and Premium choices.
- Optional anonymous usage statistics, off until someone turns them on, asked once by the Setup Wizard and changeable at any time from the System section.
- The subscription area, reserved for future Premium license management.
- External APIs, where a server owner can choose which built-in or Store app APIs may be reached from outside mvmOS. This Premium capability keeps its controls visible in the desktop for an owner without Premium, but opening or changing it shows the Premium prompt instead.
- Automations, where the server owner decides whether rules in [[Automations]] may work between apps. Rules between apps are a Premium capability; without Premium the switch is visible but opens the Premium prompt.

When External APIs are available, the owner can create tokens for built-in APIs. A token is shown only once, can be restricted to selected functions, and can be deleted immediately if it is no longer needed. Store apps that the owner opens to external APIs can instead be used by Apps Hub profiles: each profile creates and manages its own restricted tokens from the API tab on the public Apps Hub page. Tokens are sent in an `Authorization: Bearer` header and never in an address.

## Change safely

Changes to users, SSH, backups, and updates can affect access to the whole installation. Make a backup first and keep a separate administrator path available before changing remote-access settings.
