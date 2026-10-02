---
title: Apps and Store
category: Core
category_slug: core
slug: apps-and-store
order: 50
---
## Built-in tools and Store apps

mvmOS includes Core tools for desktop and server administration. Additional applications are distributed through the Store. Each app can have its own configuration, data storage, permissions, and third-party integrations, so read its documentation before enabling it. An app can also register file types of its own, so that its files open in it from File Manager and the desktop; which app opens which type can be changed in Settings under Default apps.

## Installing and updating

Use the Store to discover available apps and install the ones needed by your server. Updates may change app behaviour, so create backups for apps that store important data and review release notes before updating production systems.

## Data access

An app’s browser SQL is confined to its own database, with attaching other databases disabled. Apps that keep their records behind an API and do not use browser database calls expose only their cfg settings through that generic route. Store updates can include separate Premium modules, which are delivered only to licensed installations.

## Repository work with Git Manager

Git Manager’s issue list shows an existing local or remote branch associated with each issue. Switching branches and refreshing repository status keep the issue view open instead of replacing it with the changes panel.

## App-specific documentation

Each Store app should have its own documentation page covering its purpose, settings, permissions, storage, integrations, and troubleshooting. [[Core overview]] is the starting point for Core features; app documentation is maintained separately as the Store grows.
