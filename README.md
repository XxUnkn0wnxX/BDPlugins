# BDPlugins

Personal BetterDiscord plugins maintained in one repository.

## BDConsoleLogger

Streams Discord renderer console output into BetterDiscord's per-channel `console.log` file:

- `BetterDiscord/data/stable/console.log`
- `BetterDiscord/data/ptb/console.log`
- `BetterDiscord/data/canary/console.log`

It captures live renderer `console.*` traffic and related runtime error events after the plugin starts.

It is not a true DevTools mirror. It does not reliably capture every browser/resource warning, lower-level Chromium internal entry, or raw command text typed into the DevTools console UI.

## JumpToTop

Adds a dedicated button to Discord's channel header that takes you straight to the earliest available message in the channel or DM you currently have open.

This is useful when you want to quickly jump to the start of a conversation without manually scrolling through long chat history.

> Origin: `JumpToTop.plugin.js` is a rebuilt version from [Huderon's BetterDiscordPlugins](https://github.com/Huderon/BetterDiscordPlugins), kept here because the old plugin was crashing my Discord client.

## EmbedCopy

Adds an `EmbedCopy` submenu to message context menus when the message contains embeds.

It can copy the selected or first embed as raw Discord JSON, Carl-bot `!cembed`/`!ecembed` JSON, or a Discohook-compatible webhook payload.

## Experiments

Enables Discord's experiment UI and developer-only experiment access from BetterDiscord.

This plugin is built as a BetterDiscord-native runtime port modeled after [Equicord's Experiments plugin](https://github.com/Equicord/Equicord/blob/main/src/plugins/experiments/index.tsx). It forces local developer access, refreshes Discord's experiment stores, adds a warning card to the experiments page, and hides the bug report entry in the staff help popout.

> Experiments are unreleased Discord features. They may break the client, and server-side features still cannot be enabled locally.
