---
title: Apps Hub
category: Core apps
category_slug: core-apps
slug: apps-hub
order: 170
---
## What Apps Hub is

Apps Hub is the public-facing layer of a self-hosted mvmOS installation. It lets selected installed apps be used outside the administrator’s Linux desktop: from a normal browser, a phone, a standalone public page, or an installable PWA. It is the boundary between private server administration and the public experiences an app chooses to offer.

## Public pages are separate from the desktop

A visitor to a public app does not receive a Linux account, a desktop session, Terminal access, or access to the server filesystem. Public users sign in to an Apps Hub profile that belongs only to that self-hosted installation. An administrator decides which installed apps may have a public page and can turn each public app on or off.

## Public profiles

Apps Hub provides lightweight profiles for people using public pages. A profile can have a username, display name, avatar, language, theme, font-size preferences, favourites, notifications, and a session token. Self-registration can be allowed or closed by the installation administrator; administrators can also create, edit, remove, or promote public profiles from Apps Hub.

## Public app directory and PWA

The Apps Hub public portal lists the apps that the administrator has enabled for public access. It is installable as a PWA, so it can be added to a phone or desktop home screen. Public app pages can also have their own standalone PWA; this is intentionally separate from the main mvmOS desktop PWA described in [[Mobile and PWA]].

## Each profile chooses its own home screen

The public portal has two views of the same list. **Apps** is the profile’s own home screen; **Store** is everything the administrator has published, grouped by category, with a description for each app. Adding an app from the Store puts it on the home screen, removing it takes it off again.

Removing is only hiding: nothing the app stored for that profile is deleted, and adding the app back returns it exactly as it was. A brand-new profile starts with an empty home screen and builds it from the Store; profiles that were already using apps keep the ones they had opened.

The chosen apps, the sort order and the selected category belong to the profile and are kept on the server, so the same account sees the same home screen on a phone and on a computer.

## App-to-app communication

Apps Hub is also the switchboard for server-side app-to-app calls. An app may expose a small `app_api.py` surface, but Apps Hub keeps that API disabled until the administrator enables it for the target app. Calling apps use the central Apps Hub API rather than importing another app directly, so the permission gate remains enforceable.

Enable an app API only when there is a concrete integration to support. It is a server-side trust decision: public-page access and app-to-app API access are separate controls.

## Credits for public users

Credits are an optional Apps Hub Premium module for an installation. When the Credits module exists, each public profile has a balance and a visible transaction history. The feature is absent entirely on an installation without that module; public users do not see a purchase prompt.

An administrator can open any public user’s credit panel, add credits, deduct credits, provide a reason, and review the transaction history. Credits are not a payment processor: they are a balance controlled by the administrator of that self-hosted installation.

## Free versus credit-priced features

An app can declare the features or services that it is able to charge for. In Apps Hub, the administrator chooses the price for each declared feature:

- A price of `0` keeps that feature free for public users.
- A positive price makes the app deduct that number of credits when the user chooses the feature.
- The administrator can change a price later without changing the app code.

Apps use the central credit service to charge or grant balances. Charges are atomic and idempotent, which prevents a retried request or two simultaneous requests from charging the same action twice. An app can also grant credits for a reward, correction, refund, or other workflow chosen by the installation administrator.

## Browser extensions

Some installed apps can provide a companion browser extension. mvmOS generates the shared extension shell from the app’s declared metadata and can target Chrome and Firefox. The extension connects to the user’s chosen self-hosted mvmOS server; it is not a browser extension operated by a central mvmOS cloud.

Extensions request only the permissions declared by the app. Review the app’s extension description, browser permissions, host permissions, and supported browser versions before installing it.

## Operating Apps Hub safely

- Enable public pages only for apps that are ready to be exposed.
- Use HTTPS for all public pages.
- Close public registration when you do not need new accounts.
- Enable app-to-app APIs only for the specific integration you intend to use.
- Treat public-user administration and credit changes as sensitive operational actions.
- Review browser extension permissions before installation.
