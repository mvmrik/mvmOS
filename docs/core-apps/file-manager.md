---
title: File Manager
category: Core apps
category_slug: core-apps
slug: file-manager
order: 120
---
## Purpose

File Manager is the desktop file browser for the signed-in user’s permitted filesystem. It also supplies the file and folder picker used by other mvmOS apps.

## Capabilities

- Browse folders and inspect files, and return to the folders you came from with the Back button.
- Create, rename, move, copy, and delete files and folders.
- Upload large files in chunks.
- Search by filename and edit text files in the browser.
- Change Unix permissions and inspect real folder disk usage.
- Choose files or folders for apps that open the mvmOS picker.

## When an action fails

If a paste, rename, move to Trash or delete does not go through, File Manager lists every item that failed together with the system's own reason, such as `Permission denied`, instead of silently leaving the files where they were. The same applies to deleting files from the desktop. For permission errors it also explains the usual cause: your Linux user needs write permission on the item and on the folder that contains it. Being in the owner's group is enough only when that group also has write permission, for example after `chmod -R g+w` on the folder; a folder with mode 755 lets the group read it but not delete from it.

## Good practice

Deleting or changing permissions affects the real server filesystem. Keep backups of important content and apply restrictive permissions only when you understand the effect on the relevant app or service.
