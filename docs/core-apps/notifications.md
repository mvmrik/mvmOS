---
title: Notifications
category: Core apps
category_slug: core-apps
slug: notifications
order: 180
---
## Purpose

Notifications is the system-wide notification centre and taskbar bell. Apps can use it to bring an event back to the user’s attention.

## Capabilities

- Receive a title, message, and action link from any app.
- Show an unread count in the taskbar.
- Mark individual notices, groups of notices, or viewed notices as read.
- Delete old notifications.
- Open the relevant app or destination through an action attached to a notice.

## Desktop notices stay on the desktop

Every notice belongs to one of two audiences: the mvmOS desktop account, or an Apps Hub profile. System messages — updates, licence and app maintenance notices, anything the installation itself raises — belong to the desktop and are never shown on a public page, even when a Linux login and an Apps Hub profile happen to share the same name. A public page shows only the notices its own apps sent to that profile. The desktop bell continues to show everything addressed to the person using it.

## For app authors

Keep notification messages specific and actionable. Avoid putting passwords, API keys, or sensitive content into a notification body, especially on shared installations.
