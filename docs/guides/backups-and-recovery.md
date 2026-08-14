---
title: Backups and recovery
category: Guides
category_slug: guides
slug: backups-and-recovery
order: 250
---
## What Core backups contain

Core backups archive the mvmOS installation files while excluding the Python virtual environment and Python cache files. Backups are created under the server’s mvmOS backup directory and include a restore script beside the archive.

## Backup options

- Create a backup on demand in Settings.
- List existing backups and download one as a ZIP containing the archive and restore script.
- Set daily, weekly, or monthly scheduled backups.
- Choose how many backup generations to retain; older generations are pruned when the limit is reached.
- Delete a backup that is no longer needed.

## Recovery discipline

Copy downloaded backups to storage separate from the server. Test restoring on a safe machine before relying on a recovery process. Installed apps and their data can have their own storage and integrations, so verify that the backup covers the apps you depend on.
