---
title: Public pages and Apps Hub
category: Guides
category_slug: guides
slug: public-pages
order: 260
---
## Two kinds of users

Linux users sign in to the mvmOS desktop and operate the server. Apps Hub can separately provide public users for public pages exposed by installed apps. A public user is not a Linux account and does not gain access to the desktop or server shell.

## Public app pages

An installed app may publish a standalone public page, such as a shared tool or customer-facing workflow. Apps Hub provides the account layer and directory for these pages. Each app decides what public functionality it offers.

Enabling a public page makes the app available to every profile; each person then decides for themselves whether it appears on their own home screen, from the portal’s Store tab. Notices raised by the installation itself stay on the desktop and never appear on a public page.

## App-to-app API

Apps Hub also provides a controlled path for one installed app backend to call another in-process. Access is disabled by default per target app. Enable it only when the two apps need that integration and you understand the permission boundary.

## Publish responsibly

Public pages expose functionality beyond your private desktop. Use HTTPS, review each app’s documentation and data model, and avoid enabling unnecessary public registrations or integrations. For profiles, public PWAs, browser extensions, app-to-app permissions, and Credits, read [[Apps Hub]].
