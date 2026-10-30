---
title: Files and backups
category: Core
category_slug: core
slug: files-and-backups
order: 40
---
## Files stay on your server

File management works against the storage attached to your own mvmOS server. mvmOS does not provide central cloud storage for the files in an installation.

## Remote shared folders

File Manager can connect a folder shared by another mvmOS installation. The source
chooses the receiving server address and permissions and issues a private
invitation. The recipient adds it in File Manager's Shared folders section.
Connected folders open inside the normal File Manager, including recursive
Copy/Paste and permission-controlled changes. Preview, download and remote upload
bytes transfer directly between the browser and the source. Copies between local
and remote storage pass through the browser and use both storage servers’ traffic. The source remains responsible for access checks,
availability and backups. This is a virtual folder, not a Linux filesystem mount.

See [File Manager](../core-apps/file-manager.md) for setup and supported operations.

## Backups

Backups are an operator responsibility. Before major updates or configuration changes, create and verify a backup of the data and configuration that matter to your installation.

## Good practice

- Keep backups separate from the main server where possible.
- Test restoration, not only backup creation.
- Protect backup archives as carefully as the original data.
- Document which apps have their own databases or external integrations.
