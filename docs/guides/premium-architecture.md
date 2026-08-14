---
title: Premium architecture
category: Guides
category_slug: guides
slug: premium-architecture
order: 280
---
## Current status

Premium is a future option. mvmOS does not currently accept payments, use Patreon, or provide active Premium entitlements. Core and normal Store functionality are not dependent on Premium.

## Planned model

When enabled, a license is intended to validate a limited number of self-hosted installations. The design uses a license code, a locally generated device ID, a device label, rotating technical tokens, and check-in timestamps. These values are for license validation and seat management, not for advertising or a hosted user profile.

## How Premium code is separated

Premium Core modules are distributed separately from the ordinary Core code. An installation without a valid entitlement does not receive the Premium module; the normal Core code keeps only the integration point. Store apps follow the same principle for their own Premium features.

## No change for existing users

Free functionality remains available without a Premium key. If Premium becomes available, the website terms and privacy information will be updated before a payment or membership flow is opened.
