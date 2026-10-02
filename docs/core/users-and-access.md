---
title: Users and access
category: Core
category_slug: core
slug: users-and-access
order: 30
---
## Local accounts

mvmOS supports local users for an installation. User and session information belongs to the server running mvmOS; it is not synchronised to mvmos.org as part of normal Core operation.

## Administrative actions

Root can perform system actions directly. Other Linux users need sudo privileges and must confirm their own password. The server checks a session-bound administrator key on each protected action and renews its fifteen-minute idle period when used. Users can manage their own desktop two-factor authentication; changing another account’s setup requires administrator confirmation.

## Access responsibilities

- Create only the accounts your installation needs.
- Use strong passwords and protect the server’s administrator access.
- Remove accounts that no longer need access.
- Keep the operating system and mvmOS updated.

## Sessions and administration

Administrative actions should be limited to trusted users. If your installation is exposed to the internet, place it behind HTTPS and use the network controls appropriate for your environment.
