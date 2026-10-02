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

Enabling a public page makes the app available to every profile; each person then decides for themselves whether it appears on their own home screen, from the portal’s Store tab. When an administrator turns a public page off, a direct link shows a private-page notice and does not reveal the app’s public content. Notices raised by the installation itself stay on the desktop and never appear on a public page.

## Moving between apps

Use the app button in the shared header to switch directly between public apps without returning to the portal. It follows your home screen’s apps, category and sorting, shows up to ten plus the current app, and includes Home.

Hydration keeps each completed day’s water goal, offers drink colours and custom emoji icons, and can end the day after midnight. Health plots supplied daily goals, shows only recorded metrics in its overview, and offers an expanded laboratory catalogue and editable results through its enabled API.

mvm2factor encrypts secrets and computes codes in the browser after you unlock it. On the first open after upgrading, choose a password to encrypt existing accounts. Its JSON and CSV exports remain readable backups. The Premium integration in mvmPasswords uses encrypted code data locally, reuses an unlocked session or asks for the mvm2factor password, and can remember its key encrypted under the master key when both passwords match.

mvmAI lets you stop a reply, queue follow-up messages and review several proposed app changes together. Classifieds lets you view a listing over its conversation without closing the chat.

## App-to-app API

Apps Hub also provides a controlled path for one installed app backend to call another in-process. Access is disabled by default per target app. Enable it only when the two apps need that integration and you understand the permission boundary.

## Publish responsibly

Public pages expose functionality beyond your private desktop. Use HTTPS, review each app’s documentation and data model, and avoid enabling unnecessary public registrations or integrations. For profiles, public PWAs, browser extensions, app-to-app permissions, and Credits, read [[Apps Hub]].
