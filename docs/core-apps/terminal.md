---
title: Terminal
category: Core apps
category_slug: core-apps
slug: terminal
order: 110
---
## Purpose

Terminal opens a real interactive Linux shell in the mvmOS desktop. It is not a simulated command runner: each session is backed by a PTY process on the server.

## Capabilities

- Opens a login shell as the Linux user currently signed in to mvmOS.
- Uses that user’s real home directory and Linux permissions.
- Supports ANSI colours, interactive programs, and terminal resizing.
- Reconnects automatically after a network change, sleep, or server restart. A reconnected window starts a new shell session, so any command that was running in the previous session does not continue.
- Keeps Linux as the permission boundary; commands are not separately sandboxed by mvmOS.

## Saved commands and the quick prompt

Commands you run often can be saved once and started with a click instead of being typed again.

- Open the quick prompt with the ⚡ button in the Terminal, or from anywhere on the desktop with a keyboard shortcut, Ctrl+Shift+Space by default. Type any command and press Enter to run it, or start typing a name to pick one of your saved commands from the list. Tab copies a saved command into the input so you can adjust it first, and Esc closes the prompt. From three letters on, installed mvmOS apps whose name matches are offered too, as in the Start menu, and choosing one opens it. Free typing is always allowed; the list only offers suggestions, and Enter always runs what you typed unless you pick another row.
- The shortcut can be changed with the keyboard button at the bottom of the prompt: click it and press the new combination. It needs at least two of Ctrl, Alt, Shift and Meta, or a function key, so it never takes over shortcuts such as Ctrl+C. It is remembered only in the current browser, because a combination that your operating system or browser already uses depends on the computer.
- Choose Save as command to keep what you typed, or create and edit saved commands from the prompt. A command can have a name and an optional folder to run in.
- A saved command is typed into the Terminal you used last, or into a new Terminal if none is open. It runs like anything typed by hand, as your own Linux user, with the same output and Ctrl+C, and the Terminal stays open afterwards.
- Saved commands belong to the signed-in Linux user and are stored on the server, so they follow you between browsers. Each command must be a single line.

## Asking for values when a command runs

Put a placeholder in the command wherever a value should be entered at run time. mvmOS asks for it before the command starts.

- `{{Name}}` asks for a value each time.
- `{{Name=85}}` asks with a default already filled in.
- `{{Name:dir}}` asks with a folder chooser.
- `{{Name:raw}}` inserts the value exactly as typed, without quotes, so wildcards and pipes work.

Values are quoted for the shell automatically, so spaces and special characters in a file name stay part of one value. For example, `jpegoptim -m{{Quality=85}} {{Files:raw}}` asks for the quality and the files each time it is run.

## Hints while writing a command

While a saved command is being written, the editor suggests command names that exist on the server. The Help button shows the command’s `--help` output, or its manual page when it prints no options, and clicking an option adds it to the command. Help is read only for a plain command name found on the server, with no input, a short time limit and the permissions of your own Linux user.

## Use carefully

Terminal can make the same changes as a normal server shell. Review commands before running them, avoid pasting secrets into shared sessions, and keep administrator access limited to trusted users.
