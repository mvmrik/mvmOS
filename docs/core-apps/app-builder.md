---
title: App Builder
category: Core apps
category_slug: core-apps
slug: app-builder
order: 188
---
## Purpose

App Builder lets you create a small app for your own mvmOS by describing it to the AI. Say what the app should do, try it in a live preview next to the chat, ask for changes, and when you like it install it on this desktop or download it to give to someone else. It is meant for people who do not program: the builder already knows how mvmOS works, so an idea such as a tic-tac-toe game or a simple tracker becomes an app without writing code.

App Builder uses the AI model that is already set up in mvmAI, the same one the AI chat uses. Install mvmAI and choose an AI provider there first; App Builder tells you when this is missing. Only an administrator can use it.

## Creating an app

Choose New app and fill in the name and the category, and describe what the app should do. Pick the languages the app's texts are written in: English is selected by default, which is enough for an app that is only for you, and you can choose any of the nine languages of mvmOS. Languages can be added or removed later in Settings; when you add one, the AI is asked to translate everything. Two options decide where it can be used:

- Use Apps Hub profiles: people sign in with their Apps Hub profile to open the app, and each profile keeps its own data.
- Public web page: the app can also be opened in any browser at its own address. It needs profiles, and the administrator switches the page on in Apps Hub like for any other public app.

Without these options the app is for the desktop only. Games always use Game Hub and have no separate public page. All of this can be changed later in the Settings of the project.

## Working in the project

The chat is on the left and the live preview on the right. The AI writes the files of the app, checks them and tells you what it did; you see the result at once. The preview can be shown at phone size, restarted, and its test data reset. If the preview reports an error, one button asks the AI to fix it.

- Files shows every file of the app. You can read and edit a file by hand, delete it, and run the check that looks for problems.
- Versions keeps a copy before each AI step. Restoring one brings those files back and keeps the current ones as a version too. Each copy shows the installed version it was based on, and every install adds a copy named "Installed x.y.z", so the releases can be found and restored.
- The app's version is set by App Builder: it starts at 1.0.0 and goes up by one patch number each time changed work is installed. When the work differs from what is installed, the chip says so ("Installed 1.0.2 · changes not installed") and the button offers the next version ("Update to 1.0.3"). The installed app stays on the old version until you press it.
- Settings holds the name, category, icon emoji, description, the profile and public options, and the other apps this app may use.

The project is a draft. It is not an installed app until you press Install, and a draft does not appear in the Start menu.

## What a built app can do

An app is a plain web page made of HTML, CSS and JavaScript, with every text translated into the languages you chose and a picture icon drawn for it. An install is refused while a chosen language is missing or incomplete. When the desktop uses a language the app does not have, the app shows its first language. It runs in a protected sandbox: it has no internet access, cannot read your files, cannot see other apps, and cannot use the desktop session. It reaches the system only through a small set of functions that the builder provides and checks:

- saving its own data per person or Apps Hub profile;
- dates and times in the regional format chosen in Settings, and the shared date and time picker;
- notifications, short messages, confirmation questions, copying to the clipboard and saving a small text file;
- the light and dark themes and the language of the desktop;
- for a game, the player's name and avatar and the final score, which Game Hub records in its statistics and rankings;
- its own server code, when the app has some, see Server code;
- other apps, see below.

## Server code

Many apps need more than the browser: data shared between people, rules that must not be trusted to a browser, functions that other apps can call, or a game for several players. For these the AI can also write Python server files, always in the app's own folder: `server.py` (the app's web routes), `app_api.py` (functions for other apps, Automations and the External API) and `mp_game.py` (the server half of a Game Hub game). Most apps need none of them and simply keep their data with the built-in storage.

This code is never trusted blindly:

- It can import only a short list of harmless modules, and it cannot open files, run commands, use `eval`, or reach the system. A system backend, which can touch the whole server, is never created for a built app.
- It works through one object given by the platform: the app's own database, the Apps Hub profile of the person calling, the other apps the person declared, and web requests to public https addresses only. Addresses of this server and of private networks are refused.
- mvmOS also confines every app's files and database to the app's own folder, as for any other app.
- When an app has server code, Install says so and asks you to confirm, and the same check runs again for archives from someone else.

Python cannot be locked down completely from inside the server's own process, so this is hardening and review rather than a guarantee. Install an app with server code from another person only if you trust them.

## Games

Games are played on their Game Hub page, like every other game, and appear in Game Hub's list. A game without server code is played on one device, alone or by taking turns, and its score comes from the player's own browser. A game with `mp_game.py` can be multiplayer for two to eight people, each on any device with a browser: the server owns the rules and any hidden information, the pages draw what it sends, and Game Hub provides rooms, invitations and rankings. Multiplayer is tested in Game Hub after installing, with two browsers.

## Using other apps

When an app should work with another one, for example adding a result to a tracker, the AI offers the apps you could connect. An app is offered only when it is on your Apps Hub shelf, its app-to-app API is switched on in Apps Hub, and your profile may use it. These are the same rules as for Automations and for the AI chat. The built app is allowed to call only the apps declared in its Settings, always acts as your own profile and sees only your own data, and still works if the other app is missing. Before installing, the list of connected apps is shown to you.

## Installing, updating and removing

Install checks the app for problems and shows what will happen. The app then appears in the Start menu with its own icon. Update installed app publishes the changes of the draft; the data the app saved is kept. Uninstall removes the app and the data it saved, and the project stays in App Builder. Installed apps made with App Builder also appear in the App Store list of installed apps, where they can be removed like any other.

## Sharing and importing

Download creates a ZIP file of the project. Anyone with App Builder can choose Import and open that file as a new draft, look it over and install it. The imported app goes through the same checks as one you made yourself.

Only App Builder archives can be imported. An ordinary mvmOS app, from the Store or from its source code, is refused, and so is an archive that contains a premium folder, a system backend or any file that App Builder does not create. Server files of an imported app must pass the same checks as one the AI wrote. Apps from the Store cannot be opened, copied or changed with App Builder. An app made by someone else is marked as imported, and you should install it only if you trust the person who gave it to you.

## Safety

The AI works inside one project folder. It cannot read or change other apps, the core of mvmOS, the server or other people's data, cannot run commands, and has no internet access. The loader, the Game Hub files and the fixed server routes of an installed app are written from templates of mvmOS; the app's own server code runs only through the restricted loader described above. The sandbox, the checks and the limits on file names, types and sizes apply to every app, whether the AI wrote it or it was imported. The builder does not build licence or payment locks and refuses to recreate the protected features of existing apps.
