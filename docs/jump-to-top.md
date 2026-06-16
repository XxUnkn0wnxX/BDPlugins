# JumpToTop.plugin.js

[`JumpToTop.plugin.js`](../JumpToTop.plugin.js) adds a button to Discord's channel header that jumps to the first available message in the current channel, DM, thread, forum, or message permalink route.

> Origin: `JumpToTop.plugin.js` is a rebuilt version from [Huderon's BetterDiscordPlugins](https://github.com/Huderon/BetterDiscordPlugins), kept here because the old plugin was crashing my Discord client.

## What It Does

- adds a toolbar button next to Discord's header controls
- navigates the current message route to `/0`
- uses Discord's navigation helper when available
- falls back to `history.pushState` and a `popstate` event
- removes the button on non-message pages
- keeps the button restored across route changes and Discord rerenders

## Usage

Open a channel, DM, thread, forum post, or message permalink route and click the header button labeled `Jump to first message`.

The button also handles keyboard activation with Enter or Space.

## Good To Know

- Discord may only load the earliest message it can currently resolve.
- The button is intentionally hidden on non-message pages such as server boost pages.
- The plugin restores Discord's header when stopped by removing its injected button and styles.
