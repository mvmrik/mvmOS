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
- Open a folder as root in its own administrator window, if your Linux user may use sudo.
- Choose files or folders for apps that open the mvmOS picker.

## When an action fails

If a paste, rename, move to Trash or delete does not go through, File Manager lists every item that failed together with the system's own reason, such as `Permission denied`, instead of silently leaving the files where they were. The same applies to deleting files from the desktop. For permission errors it also explains the usual cause: your Linux user needs write permission on the item and on the folder that contains it. Being in the owner's group is enough only when that group also has write permission, for example after `chmod -R g+w` on the folder; a folder with mode 755 lets the group read it but not delete from it.

When the reason is a permission error and your user may use sudo, the list also offers to try the failed items again as administrator. After you enter your own Linux password, only those items are repeated as root, and administrator access ends again right after. Root cannot use your Trash, so a move to Trash repeated this way deletes the items permanently, and the password dialog says so.

## Administrator mode

A user who may use sudo can right-click a folder, or the empty space in a folder, and choose Open as root. After you enter your own Linux password, not the root password, a separate File Manager window opens with a root badge in its title bar. Everything in that window runs as root: browsing, copying, renaming, uploads, permission and owner changes, and files you open from it in the text editor, code editor or media viewer. Your other windows keep working as your own user.

Administrator access ends after 15 minutes without use, the same way sudo asks again after a while. The badge counts down the remaining time, and every action in the window, or in an editor opened from it, starts the count again. When the time runs out, the next action asks for the password again and then continues. Click the badge to leave administrator mode at any time. Deleting in an administrator window is always permanent, because root cannot put items into your Trash, so File Manager asks you to confirm it first. Your password is checked on the server for every administrator key, and a key only works with the session it was issued for.

## Good practice

Deleting or changing permissions affects the real server filesystem. Keep backups of important content and apply restrictive permissions only when you understand the effect on the relevant app or service. Use administrator mode only for the change you need and leave it when you are done.
