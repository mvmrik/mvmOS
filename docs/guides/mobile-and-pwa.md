---
title: Mobile and PWA
category: Guides
category_slug: guides
slug: mobile-and-pwa
order: 230
---
## mvmOS desktop PWA

The mvmOS desktop provides a web-app manifest and can be installed from a compatible browser. On Android this is usually offered as Install app or Add to Home screen. On iPhone and iPad, use Safari’s Share menu and Add to Home Screen.

The installed desktop opens in standalone mode, but it still connects to your self-hosted server. It is not an offline copy of mvmOS: the service worker intentionally does not cache application data or pages for offline use.

## Mobile desktop layout

On small screens, mvmOS adapts the desktop for touch use. Apps can open full-screen without a title bar, sidebars receive mobile toggles, and desktop widgets move to a separate swipeable widgets page. The full-screen behaviour can be changed in Display settings.

## Public app PWAs

Apps Hub public pages can be installed separately as a PWA. Individual Store apps that expose standalone public pages can also provide their own installable PWA metadata. These are distinct from the administrator’s mvmOS desktop and use the public app experience instead.

## Security note

Installing a shortcut does not change authentication or network security. Protect the server URL with HTTPS and use the same care as when accessing the desktop in a normal browser tab.
