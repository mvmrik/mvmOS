---
title: Settings and system
category: Core
category_slug: core
slug: settings-and-system
order: 60
---
## Configuration

Core settings control the behaviour and appearance of the installation. Server-facing Core tools can also expose system administration capabilities such as service management, packages, scheduled work, domains, projects, and SSH-related configuration.

## Setup and privacy

The Setup Wizard appears automatically on a new installation and is always available again from the System section of Settings. It keeps regional choices, optional error reports, app discovery, and Premium information in one guided pass. When an update adds a new wizard screen, Settings marks it for review without interrupting an active desktop session.

Anonymous usage statistics are optional and disabled by default. If enabled, mvmOS sends only the installation id, mvmOS version, interface language, licence state, installed-app count, and Python and operating-system versions. It does not send hostnames, addresses, user data, app names, licence keys, files, or database contents. Turning the option off stops reports immediately.

## Change safely

- Read an option before applying it to a production server.
- Change one operational setting at a time when diagnosing a problem.
- Keep a verified backup before changing services, domains, or system configuration.
- Use least privilege: grant only the access required for a task.

## Troubleshooting

If an error-report dialog appears, you choose whether to send a technical report. Review its details before sending it. See the site [[Privacy Notice|Privacy Notice]] for the exact diagnostic fields that can be included.
