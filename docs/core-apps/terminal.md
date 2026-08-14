---
title: Terminal
category: Core apps
category_slug: core-apps
slug: terminal
order: 110
---
## Purpose

Terminal opens a real interactive Linux shell in the mvmOS desktop. It is not a simulated command runner: each session is backed by a PTY process on the server.

## Capabilities

- Opens a login shell as the Linux user currently signed in to mvmOS.
- Uses that user’s real home directory and Linux permissions.
- Supports ANSI colours, interactive programs, and terminal resizing.
- Keeps Linux as the permission boundary; commands are not separately sandboxed by mvmOS.

## Use carefully

Terminal can make the same changes as a normal server shell. Review commands before running them, avoid pasting secrets into shared sessions, and keep administrator access limited to trusted users.
