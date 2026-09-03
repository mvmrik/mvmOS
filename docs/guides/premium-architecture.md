---
title: Premium architecture
category: Guides
category_slug: guides
slug: premium-architecture
order: 280
---
## Current status

Premium is being built out incrementally. Core and normal Store functionality are not dependent on Premium, and using mvmOS does not require a Premium subscription.

## Planned model

When enabled, a license is intended to validate a limited number of self-hosted installations. The design uses a license code, a locally generated device ID, a device label, rotating technical tokens, and check-in timestamps. These values are for license validation and seat management, not for advertising or a hosted user profile.

## How Premium code is separated

Premium Core modules are distributed separately from the ordinary Core code. An installation without a valid entitlement does not receive the Premium module; the normal Core code keeps only the integration point. Store apps follow the same principle for their own Premium features.

## No change for existing users

Free functionality remains available without a Premium key. The website terms and privacy information are kept current with however Premium actually works at any given time.
