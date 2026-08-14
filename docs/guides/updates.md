---
title: Updates
category: Guides
category_slug: guides
slug: updates
order: 220
---
## Core updates

Core updates are managed from Settings. They update the mvmOS installation itself, including the desktop and server-side Core code. Read release notes and create a backup before updating a production server.

## Store updates

[[App Store]] checks configured app, widget, and theme stores for newer versions. It compares installed versions with the relevant store manifests and can flag a minimum Core version when an app requires one.

## Safe update routine

- Create and verify a backup.
- Check whether an app update requires a newer Core version.
- Update Core first when required, then update dependent apps.
- Restart or verify an app’s background service where the app requires one.
- Test the main workflow after the update rather than assuming a successful download is sufficient.

## If the interface is unavailable

Core can also be updated from a server terminal. Keep a tested server-access path available so a browser issue does not block maintenance.
