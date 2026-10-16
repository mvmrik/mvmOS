---
title: Apps and Store
category: Core
category_slug: core
slug: apps-and-store
order: 50
---
## Built-in tools and Store apps

mvmOS includes Core tools for desktop and server administration. Additional applications are distributed through the Store. Each app can have its own configuration, data storage, permissions, and third-party integrations, so read its documentation before enabling it. An app can also register file types of its own, so that its files open in it from File Manager and the desktop; which app opens which type can be changed in Settings under Default apps.

## Installing and updating

Use the Store to discover available apps and install the ones needed by your server. Updates may change app behaviour, so create backups for apps that store important data and review release notes before updating production systems.

## Data access

An app’s browser SQL is confined to its own database, with attaching other databases disabled. Apps that keep their records behind an API and do not use browser database calls expose only their cfg settings through that generic route. Store updates can include separate Premium modules, which are delivered only to licensed installations.

## Repository work with Git Manager

Git Manager’s issue list shows an existing local or remote branch associated with each issue. Switching branches and refreshing repository status keep the issue view open instead of replacing it with the changes panel. Issue titles, descriptions and comments can be selected and copied. The description editor keeps enough height to remain usable when the window is crowded.

## Conversations and projects in mvmAI

Pin a conversation to keep it first and prevent automatic archiving. Use right-click or long press for Pin, Unpin, Rename and Archive; on a phone, swipe left to reveal the action buttons. Unpin a chat before archiving it. Opening conversations and projects updates their recent-use order, while automatic archiving follows the last sent message rather than merely viewing a conversation.

Administrators can click the provider and model above the composer to choose them for a new chat or change them in an existing conversation. A model change keeps the conversation history and adds a visible note; saved answers show their provider. A running reply must finish or be stopped before switching its model. Switching to another chat leaves its work running, and Send now on a queued message interrupts the current reply to send that message next. Usage bars show supported CLI subscription limits and reset countdowns; tap the bar on a phone to cycle through available limits.

Projects accept typed instructions and an optional instructions file when created or edited. Relative file paths resolve against the project folder, and the file is reread before every message. View files expands the project’s file tree and Git status. The Files gallery shows the current project’s files first and keeps other files in an expandable group.

Administrator downloads are copies in the profile’s dedicated chat-files folder. Deleting an archived conversation removes its attached files and download copies, retaining files still referenced by another chat and leaving project originals untouched. The deletion confirmation explains this cleanup. The desktop Premium activity view shows the actual CLI session and its output; see [[Terminal]].

## Image Optimizer preferences

The advanced tools offer Save settings for each Apps Hub profile in the current browser. Turn it off to use settings only for the current batch; Clear results then restores defaults. Reset settings restores defaults directly. If transformation tools fail to load, processing stops with an error so the requested options are not silently skipped. A ZIP-tool failure is reported separately.

## Belot table rules and feedback

Belot offers a rule for doubling the capot bonus in no-trump deals. It is enabled by default: with the standard multiplier and bonus, a no-trump capot scores 44 game points, or 35 when the bonus is not doubled. In Bulgarian Belot, belote must be announced with the first card of the king-and-queen pair. Bots take previous bids and their partner’s suit into account when bidding.

Bot moves arrive in order and the table presents each with its own animation pause. Played cards and submitted bids show immediate feedback, and legal-card highlighting keeps the hand aligned. If a move is unanswered, its control becomes available again and the table requests the current state.

## App-specific documentation

Each Store app should have its own documentation page covering its purpose, settings, permissions, storage, integrations, and troubleshooting. [[Core overview]] is the starting point for Core features; app documentation is maintained separately as the Store grows.
