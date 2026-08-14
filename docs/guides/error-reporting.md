---
title: Error reporting
category: Guides
category_slug: guides
slug: error-reporting
order: 270
---
## Opt-in diagnostics

When mvmOS detects a browser error or a server response failure, it can show a report dialog. Nothing is sent until the user chooses Send report. The dialog also offers an option to stop showing future report prompts.

## What a report contains

The report is technical context for debugging: an error message and stack trace, affected URL and status, active app names, browser and operating-system information, screen resolution, mvmOS version, time, and a small list of recent requests. It does not intentionally include a name, email, user account, installation identifier, license token, files, or database contents.

## Review before sending

URLs, error text, and app names can still reveal context about your installation. Open the report details, remove or avoid sensitive information where possible, and choose Do not send if you are unsure. See [[Privacy Notice|Privacy Notice]] for the website service’s current handling of reports.
