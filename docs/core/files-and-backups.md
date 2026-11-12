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
availability and backups. Files and folders written into a shared folder are created with normal permissions (644 and 755), so other programs on the sharing server, such as a media server, can read them. This is a virtual folder, not a Linux filesystem mount.

See [File Manager](../core-apps/file-manager.md) for setup and supported operations.

## Backups

Backups are an operator responsibility. Before major updates or configuration changes, create and verify a backup of the data and configuration that matter to your installation.

### Where system backups are stored

In Settings, System, Backup, an administrator chooses the places that receive system backups. A place is either a folder on this server, picked with the shared folder picker (it starts as `/var/backups/mvmos`, and the folder can be changed), or a folder shared from another mvmOS that allows uploading.

Every place has its own schedule (disabled, daily, weekly or monthly) and its own number of backups to keep. For example, a folder on this server can receive a backup every day while a remote folder receives one every week, so a failure of one device still leaves a backup. At the scheduled time only the places that are due receive a backup. Create Backup stores one in every place.

An archive is made once per run and copied to each place that is due. If one place cannot be reached, the others still receive the backup and the result names the place that failed. Backups in remote places are listed in Settings but are downloaded and removed from the sharing server itself; the shared folder needs upload permission, and old backups there are pruned only when it also allows delete.

## Good practice

- Keep backups separate from the main server where possible.
- Test restoration, not only backup creation.
- Protect backup archives as carefully as the original data.
- Document which apps have their own databases or external integrations.
