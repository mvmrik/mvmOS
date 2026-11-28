---
title: Apps and Store
category: Core
category_slug: core
slug: apps-and-store
order: 50
---
## Built-in tools and Store apps

mvmOS includes Core tools for desktop and server administration. Additional applications are distributed through the Store. Each app can have its own configuration, data storage, permissions, and third-party integrations, so read its documentation before enabling it. An app can also register file types of its own, so that its files open in it from File Manager and the desktop; which app opens which type can be changed in Settings under Default apps.

## Apps you build yourself

[[App Builder]] creates small apps of your own by talking to the AI chosen in mvmAI. They run in a protected sandbox, are installed from App Builder instead of the Store, and can be downloaded and imported by other people with App Builder.

## Installing and updating

Use the Store to discover available apps and install the ones needed by your server. Updates may change app behaviour, so create backups for apps that store important data and review release notes before updating production systems.

## Programs an app needs

Some apps rely on programs of the Linux system itself, for example the MySQL client for a database tool or `ping` for a monitor. mvmOS installs what it needs for itself together with the system, and an update checks it again. When you open an app that needs something more which is missing, a window lists the missing programs and what each is for. Choose Install: an administrator who is not root confirms with their own password, the installation runs in a terminal inside the window so you can follow it, and the app starts by itself when it is finished. If the installation fails, the output stays visible and you can try again. Installing programs needs an administrator, and the window works with apt, dnf, yum, zypper and pacman; on another system it names the programs so you can install them yourself.

## Data access

An app’s browser SQL is confined to its own database, with attaching other databases disabled. Apps that keep their records behind an API and do not use browser database calls expose only their cfg settings through that generic route. Store updates can include separate Premium modules, which are delivered only to licensed installations.

## Store application documentation

Documentation for individual Store applications is maintained in the [Store repository](https://github.com/mvmrik/mvmos-store/tree/main/docs). Core documentation covers the platform, installation, permissions and shared interfaces. Changes to an application's features or instructions belong to the Store and do not require a Core release.
