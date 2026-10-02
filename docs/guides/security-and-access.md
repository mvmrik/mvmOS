---
title: Security and access
category: Guides
category_slug: guides
slug: security-and-access
order: 240
---
## Treat mvmOS like SSH

mvmOS signs users in with their Linux credentials and can provide a real terminal and filesystem access. An internet-facing mvmOS installation should receive the same level of protection as SSH administration.

## Recommended baseline

- Use HTTPS through Nginx or a Cloudflare Tunnel.
- Do not expose an unprotected mvmOS port directly to the public internet.
- Enable two-factor authentication in Settings for accounts that need it.
- Use strong Linux passwords and remove unused accounts.
- Keep the operating system, Core, and installed apps updated.
- Restrict root and administrator access to trusted people.

## Administrator confirmation

The server checks administrator rights for installation changes, Linux user management, packages, services, configuration, domain publication, backups and Core updates. Root sessions pass directly. A sudo-capable user confirms their own Linux password; the resulting key works only with that session and expires after fifteen minutes without use. Changing another user’s desktop two-factor setup also requires administrator rights.

Browser SQL for apps and widgets cannot attach another database or create a separate file with VACUUM INTO. For apps with their own API and no browser database calls, the generic database route exposes only the cfg settings table.

## Built-in protections

The login flow rate-limits repeated failed attempts. Two-factor authentication uses time-based one-time codes. These controls reduce risk but do not replace server hardening, firewall rules, backups, or careful account administration.
