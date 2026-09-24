---
title: Desktop
category: Core
category_slug: core
slug: desktop
order: 20
---
## The workspace

The mvmOS desktop runs in the browser and is designed around windows instead of separate web pages. Open built-in tools and installed apps from the launcher, move them around the workspace, and return to them without leaving the desktop.

## What you can do

- Launch Core tools and installed Store apps.
- Work with more than one app window at the same time.
- Pin a window's size and position with the pin button in its title bar, so that app always opens in the same place on this device. The pin is stored only in this browser, is never synced to other devices, and is released as soon as you move, resize or maximize the window. Pinning is not available on phones, where windows always fill the screen.
- Keep a window above all others with the always-on-top button in its title bar, next to the pin. Other windows can still take the focus, but they open and move underneath it; press the button again to release it. Like pinning, it is not available on phones.
- Click a window's taskbar button to bring it to the front, restore it if it is minimized, or minimize it when it is already the active window, the same way desktop operating systems do.
- Find an app by typing at least three letters in the Start menu search or in the Terminal's quick prompt. An app is found by the name shown in your language and also by its original English name or id, so "term" and "терм" both find the Terminal on a Bulgarian desktop. Case and accents are ignored.
- Send screenshots, text and files to the [[Clipboard]] by pasting with Ctrl+V, dragging files onto the desktop, or choosing Paste to mvmOS Clipboard from the right-click menu.
- See who you are working as at the top of the Start menu: your Linux user, and directly beneath it the Apps Hub profile this browser is signed in to, with its avatar. The profile row appears only while you are signed in, follows sign-in and sign-out immediately, and opens your Apps Hub account when clicked. The Apps Hub sign-in belongs to the browser, so every desktop window in it acts as the same profile.
- Use the desktop layout, navigation controls, and theme preferences provided by [[Settings and system]].
- Receive in-product notices through the notifications system when an installed feature uses it.

## Right-click menu

mvmOS replaces the browser's own right-click menu with a system menu that works in every window, so the same actions are always at hand: Cut, Copy, Paste and Select all where they make sense (including inside the Terminal, where Copy uses the terminal's selection), Open link in new tab and Copy link address on links, Paste to mvmOS Clipboard, and Reload page. Paste and Cut need the browser's permission to use its clipboard the first time; if it is refused, Ctrl+V still works.

An app or window that shows its own menu, such as the File Manager or the desktop icons, keeps it; the system menu appears only where nothing else does. Hold Shift while right-clicking to get the browser's own menu instead, for example to inspect an element. Phones keep the normal long-press behaviour for selecting text.

For app authors: call `preventDefault()` on the `contextmenu` event to show your own menu, or put a `data-native-menu` attribute on an element to keep the browser's menu there.

## Practical tip

Use the desktop for operational work and the public site for product information, downloads, and documentation. The desktop is tied to your own self-hosted installation; it is not a hosted mvmOS account.
