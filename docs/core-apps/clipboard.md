---
title: Clipboard
category: Core apps
category_slug: core-apps
slug: clipboard
order: 185
---
## Purpose

Clipboard is a shelf for text, screenshots, photos and files that follows you between devices. Put something on it from a phone and pick it up on the computer, or drop a screenshot on the desktop and point at it from a terminal or another tool that can read the installation's files. Nothing is sent anywhere else: items stay on the installation.

## Ways to add something

- Press Ctrl+V anywhere on the desktop. A pasted image or file is saved straight away; pasted text is saved when the cursor is not inside a text field or another app.
- Drag files from the computer onto the desktop. A banner appears while a file is over the screen; areas that take dropped files themselves, such as the File Manager list, keep working as before.
- Right-click anywhere in mvmOS — the desktop background or inside any window — and choose Paste to mvmOS Clipboard, or use the Paste button in the Clipboard window. The entry is part of the [[Desktop]] system context menu. The browser may ask for permission to read its clipboard; Ctrl+V never needs one.
- Open the Clipboard from the taskbar button or the Start menu to type a note, upload files, or on a phone take a photo with the camera.

A small dot on the taskbar button shows that something new arrived from another device.

## Managing items

Each item can be copied back to the system clipboard (text and common image types), downloaded, pinned, or deleted. On the desktop, files also have Copy path, which copies the file's location on the server so it can be pasted into a terminal or handed to a tool that reads files from the installation. The public page never shows server paths. Long text is shown collapsed and opens with a click. Clear removes everything that is not pinned.

Items are removed automatically 24 hours after they were added. Pinned items stay until they are unpinned or deleted. One file can be up to 50 MB, and a single owner can keep up to 250 MB and 200 items; when a limit is reached the new item is refused with a message instead of older ones being deleted silently.

## Where things are stored

Files are kept in the installation's `clipboard` folder, named with the item number and the original file name, and are never committed to the source repository. Text is kept only in the database. Every item records who owns it, so no per-profile folders are created.

## Who can see what

Each item belongs to either the desktop account or an Apps Hub profile. The desktop shows the items of the person signed in to the desktop and, when the browser is also signed in to an Apps Hub profile, that profile's items too. New items are saved to the profile when one is signed in, otherwise to the desktop account. To see on the computer what was sent from a phone, sign in to the same Apps Hub profile in the desktop browser as well. The Apps Hub sign-in belongs to the browser and is shared by every window on the desktop; the Clipboard window shows which profile is active at the top, or a Sign in button when there is none.

## Public page

The Clipboard has a public page at `/pub/clipboard/`, reachable from Apps Hub like other public apps. It is turned off by default; an administrator switches it on in Apps Hub. When it is off the page and its API answer that the app is private. The public page requires an Apps Hub sign-in and only ever shows that profile's own items. It offers the same actions, and on phones the camera button opens the camera directly.

## Safety

Stored files are never run by the browser. They are served with a strict content policy and without content-type guessing, only common raster images are displayed inline, and everything else — including SVG — is offered as a download. File names are cleaned so they cannot point outside the clipboard folder.
