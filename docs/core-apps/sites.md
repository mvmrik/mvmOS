---
title: Sites
category: Core apps
category_slug: core-apps
slug: sites
order: 130
---
## Purpose

Sites combines an Nginx site manager with a lightweight workspace for small web projects. It is intended for managing sites from the mvmOS desktop instead of editing every configuration file by hand.

## Capabilities

- List, create, and delete static or reverse-proxy Nginx sites.
- Scaffold a small web project with a FastAPI router and static index page.
- Publish a project under a path or a custom domain.
- Use a live-reloading development loop while editing a project.
- Start and stop the mvmOS public-facing web-server process.

## Before publishing

Confirm domain DNS, HTTPS, access control, backups, and the security of any application you expose publicly. A site can make services on your server reachable from the internet.
