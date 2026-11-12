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
- Open each kind of file with the app you choose, and pick another app for a single file with Open with.
- Change Unix permissions and inspect real folder disk usage.
- Open a folder as root in its own administrator window, if your Linux user may use sudo.
- Choose files or folders for apps that open the mvmOS picker.

## Opening files and default apps

Double-clicking a file in File Manager or on the desktop opens it with the default app for its type. Out of the box images open in the image viewer, video and audio in the media player, source code in the code editor, plain text in the text editor, `.url` shortcuts in the browser, and archives are extracted in place. Installed apps can register file types of their own, and the chosen default app opens files with those extensions.

Right-click a file and choose Open with to pick another app for that one file. The code editor and the text editor are always offered, whatever the file is. Tick Always use this app to make the choice the new default for every file with that extension. A file type that no app claims shows the same choice when you double-click it. From Core 1.22.0, if an installed Store app competes with another handler and you have not saved a choice, double-clicking also opens this chooser. Saving a default removes the ambiguity.

Settings has its own Default apps section. It first shows every app with the file types it opens, your own choices highlighted, and then the list of file types to change. File types that share the same app and the same choices share a row, and changing a row changes all of them. Type an extension in the search field, or click it under its app, to change just that one; an extension no app knows yet, such as `pdf`, can be given an app the same way. Restore defaults removes all your choices. If the app you chose is uninstalled, its file types go back to their default app.

## When an action fails

If a paste, rename, move to Trash or delete does not go through, File Manager lists every item that failed together with the system's own reason, such as `Permission denied`, instead of silently leaving the files where they were. The same applies to deleting files from the desktop. For permission errors it also explains the usual cause: your Linux user needs write permission on the item and on the folder that contains it. Being in the owner's group is enough only when that group also has write permission, for example after `chmod -R g+w` on the folder; a folder with mode 755 lets the group read it but not delete from it.

When the reason is a permission error and your user may use sudo, the list also offers to try the failed items again as administrator. After you enter your own Linux password, only those items are repeated as root, and administrator access ends again right after. Root cannot use your Trash, so a move to Trash repeated this way deletes the items permanently, and the password dialog says so.

## Administrator mode

A user who may use sudo can right-click a folder, or the empty space in a folder, and choose Open as root. After you enter your own Linux password, not the root password, a separate File Manager window opens with a root badge in its title bar. Everything in that window runs as root: browsing, copying, renaming, uploads, permission and owner changes, and files you open from it in the text editor, code editor or media viewer. Your other windows keep working as your own user.

Administrator access ends after 15 minutes without use, the same way sudo asks again after a while. The badge counts down the remaining time, and every action in the window, or in an editor opened from it, starts the count again. When the time runs out, the next action asks for the password again and then continues. Click the badge to leave administrator mode at any time. Deleting in an administrator window is always permanent, because root cannot put items into your Trash, so File Manager asks you to confirm it first. Your password is checked on the server for every administrator key, and a key only works with the session it was issued for.

## Shared folders between servers

Both servers need Core with shared-folder support. On the computer that stores the
files, right-click a local folder and choose **Share folder**. Enter the receiving
server's HTTPS origin (for example `https://home.example.com`), give the folder a
name, and choose permissions. Browsing names is always allowed; opening/downloading,
uploading/creating folders, renaming, and deleting are separate permissions.
Sharing uses the signed-in Linux user's filesystem access, even from a temporary
administrator window. Symbolic links and special files are excluded.

Copy the invitation immediately; the source only stores a hash of its access key
and cannot display it again. On the receiving server, open **Shared folders** in
File Manager's sidebar, choose **Connect folder**, and paste the invitation. The
address must exactly match the receiving server's origin, including a non-default
port. Invitations are access credentials: give them only to the intended recipient.
Connections are private to the Linux account that adds them, and survive signing
out or using another browser with that account.

The manager lists folders received and folders shared by your account. It checks
received folders directly from the browser and shows when they are unavailable or
access has been revoked. Open a connected folder from the manager or sidebar to
browse it in the same File Manager window, with selection, sorting, name filtering,
breadcrumbs and Back/Up navigation. Double-click files to preview supported images,
audio, video and small text files, or download individual files. Deep search,
terminal access, local application associations, Linux ownership changes and ZIP
creation are unavailable for remote folders.

Copy/Paste supports files and whole folders between local and remote locations,
and between connected folders. Cut/Paste removes the source only after the whole
copy completes. Reading is required at the source, uploading at the destination,
and deleting at the source for Cut. Existing destination names are refused instead
of merging or replacing them. Transfers use 4 MiB chunks and can be cancelled;
completed files and folders may remain at the destination after cancellation or
failure. Copying is limited to 10000 items and 64 folder levels per operation.
Files dropped from your computer can include whole folders.

Remote uploads and renames refuse to overwrite an existing destination. Deleting
is permanent and includes a folder's contents after confirmation; there is no
remote Trash. Use the source server to change permissions by revoking the old grant
and issuing a new invitation.

The receiving server stores references and access credentials, not copies of the
shared files. Listings, previews, downloads and uploads travel directly between
the browser and the source server. Copies between locations pass through the
browser: copying to or from local server storage also consumes that server’s
traffic. Merely browsing or playing remote files does not relay their bytes through
the receiving server. A tunnel or reverse proxy on that source's own
address still participates in its traffic. The source must be reachable from the
user's device. Disconnecting removes the local reference; **Revoke access** on the
source invalidates the grant and previously issued file tickets for new requests.
An already running transfer may finish. File tickets expire after one hour.

These folders are virtual entries in File Manager, not Linux mounts. Apps do not
accept them automatically. An app that adopts the shared file picker and uploader
(mvmAudio and qBit Dashboard so far) can offer a choice between this device, the
mvmOS server and a shared folder when you pick files or a place to save to. The
picker opens in a centred window and shows only the places the app allows. On the
server you see only what your own Linux account may read, and some apps keep you
inside your home folder. Files taken from a shared folder are not copied: they are
played or read from the sharing server, which spends the traffic. Uploads from any
app appear in one panel with progress and speed, wait their turn, are cut into parts
below Cloudflare's size limit, and can be stopped or tried again. A folder or an
archive can be uploaded, and an app may unpack the archive on arrival.

## Disks and external drives

The File Manager sidebar has a Devices place between Computer and Trash. Opening it lists the disks and partitions the server does not run from, such as a USB drive or a second internal disk, with label, size, file system and whether each is mounted, or says that no disks were found. A disk that the system sees but cannot be offered, such as a locked encrypted volume (LUKS or BitLocker), an unsupported file system or a disk without a file system, is shown dimmed with the reason. Once an encrypted volume has been unlocked in Linux, for example at start-up, the unlocked volume is listed like any other disk and the locked container is hidden. Swap, RAID and LVM members and the disk that holds the system are never listed.

A mounted disk opens like any other folder. Double-click a disk that is not mounted to mount it under `/media/mvmos/<label>` and open it. Right-click a disk for its menu: a disk that is not mounted offers Mount once and Mount at every start, and a mounted disk offers Open, Unmount, and the choice to start or stop mounting it at every start. Mounting and unmounting are limited to an administrator: root, or a sudo user who confirms their own password. Everyone else can only open disks that are already mounted. The eject button next to a mounted disk unmounts it, and a USB disk is powered off so it can be unplugged. Unmount fails with the system's message while a program still uses the disk.

Mount once keeps the disk mounted until it is unmounted or the server restarts. Mount at every start adds one line to `/etc/fstab`, marked with a `# mvmos:` comment, that identifies the disk by its UUID and uses `nofail`, so a disk that is unplugged never stops the server from starting. A copy of the original file is kept as `/etc/fstab.mvmos.bak` the first time. Stop mounting at every start, or Unmount and stop mounting at start, removes that line again. A disk that the server owner already listed in `/etc/fstab` by hand is shown as mounted at every start and is never changed by File Manager.

Disks are mounted with `nosuid` and `nodev`. FAT, exFAT and NTFS disks have no Unix owners, so they are mounted owned by the account that asked, and a disk with a read-only medium opens read-only. What a person can read inside a disk is still decided by the Linux permissions of their own account.

Every row shows the disk's name, its model and device name, its size, its file system and, when it is mounted, how much space is free.

### Ownership of a new disk

A Linux file system such as ext4 belongs to root when it is mounted for the first time, so a normal account cannot write to it or share a folder from it. The right-click menu of a mounted disk has Make me the owner of the disk, which gives the administrator who asks the top folder of the disk, and Make me the owner of everything on the disk, which changes every file and folder after a confirmation and can take a long time on a large disk. Disks without Unix owners do not offer them.

### Formatting a new disk

A disk or partition that has no file system and is not mounted shows Format as ext4 in its right-click menu. The administrator chooses a name, must type the device name to confirm, and the disk gets a GPT partition table with one partition and an ext4 file system that is owned by the administrator who formatted it. Only a completely empty disk can be formatted: anything that already has a file system, partitions, a mount or the system on it is refused.

### Information and health

Info in the right-click menu of a disk shows its name, device, file system, UUID, size, where it is mounted, whether it is mounted at every start, a usage bar with the free space, and the model, serial number and kind of the physical disk. When the `smartctl` program from the `smartmontools` package is installed on the server, it also shows the health reported by the disk: the overall result, temperature, power-on hours, reallocated and pending sectors, and wear or media errors for NVMe disks. Without it the health line says that smartmontools is needed, and virtual disks do not report health.

The Computer place has Info in its right-click menu. It shows the space used and free on every mounted file system of this server and the model, kind and health of each physical disk.

## Good practice

Deleting or changing permissions affects the real server filesystem. Keep backups of important content and apply restrictive permissions only when you understand the effect on the relevant app or service. Use administrator mode only for the change you need and leave it when you are done.

## Creating a folder in an app’s picker

When an app asks you to choose a folder or save destination, the shared picker offers New folder. Enter a name without slashes. A new save destination is selected immediately; when selecting folder contents, the picker opens the new folder. Shared folders offer creation only when their upload permission allows it, and apps can disable the option.
