---
title: Automations
category: Core apps
category_slug: core-apps
slug: automations
order: 187
---
## Purpose

Automations lets apps act on their own. A rule says when it runs, what has to be true, and what to do: for example, when water is logged in Hydration, add an amount to a Budget category, or every morning at eight send a notification. Apps do not have to be written for it. Automations works with every installed app that offers functions to Apps Hub, the same functions the External APIs in [[Settings]] use.

## Building a rule

Open Automations from the Start menu and choose New rule. A rule is built from top to bottom in three steps.

- **When**: choose the app first, then what happens in it, such as Add entry, or Every day at a time with the time of day. Everything after this starts from the chosen app, so it is never asked for twice.
- **Only if** (optional): compare a number the app reports right now, such as today's total in Hydration, with a value, or a value the event itself carried, listed under This event: which task was completed, which Budget category was changed, how many millilitres the drink had. Values that point to something in the app are chosen from a list of your own items. With more than one condition, choose whether all of them must be true or at least one, for example to react when either of two tasks is completed. Run now and a time of day carry no event values, so a condition on them does not hold then.
- **Then**: one or more actions. The chosen app's own functions are listed first, followed by Send me a notification. Each function shows its fields with their names; fields that refer to something in the app, such as a Budget category or a drink, are chosen from a list of your own items.

At most once a day keeps a rule from running more than once on the same day. A notification can use `{rule}` for the rule's name and `{day}` for today's date.

The list shows every rule with a switch to turn it on or off, a short summary, and the result of its last run. Run now runs a rule straight away, and Journal shows its last runs with what was done or why it stopped.

## Rules between apps

A rule that reads a value from another app, calls another app's function or sends a web request is a rule between apps. This is a Premium feature and the server owner turns it on in the Automations window's gear, under Settings → Automations. The change applies at once, also in an Automations window that is already open. When it is off, other apps simply do not appear in the editor, and an existing rule that uses them stops with an explanation in its journal instead of running halfway.

A web request is a POST with JSON containing the rule's name, the app, the event, the message and the time. It may only go to a public internet address, never to the server itself or its local network, and redirects are not followed.

## When rules run

A rule with an event runs when that thing happens in the app, whether it was done in the app's window, on its public page or through the External APIs. Nothing is polled: the app's own request is what starts the rule. A rule with a time of day runs once at that minute. Actions done by a rule never start other rules, so rules cannot set each other off in a loop, and a single rule runs at most 30 times an hour.

## Who can see what

Rules belong to the Apps Hub profile the browser is signed in to, and the desktop window asks for a sign-in when there is none. Every value a rule reads and every action it takes is done as that profile, so a rule only ever sees and changes its owner's own data.

## Public page

Automations has a public page at `/pub/automations/` with the same editor, reachable from Apps Hub like other public apps. It is turned off by default; an administrator switches it on in Apps Hub. When it is off the page and its API answer that the app is private.
