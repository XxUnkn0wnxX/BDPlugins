# Experiments.plugin.js

[`Experiments.plugin.js`](../Experiments.plugin.js) enables Discord experiment access and developer experiment UI in BetterDiscord.

It is a BetterDiscord-native runtime port modeled after [Equicord's Experiments plugin](https://github.com/Equicord/Equicord/blob/main/src/plugins/experiments/index.tsx).

## What It Does

- forces local developer access where Discord checks user flags
- refreshes experiment stores after patches are applied
- exposes Discord's experiment UI
- supports experiment and playground dev-link embeds
- adds a warning card to the experiments page
- hides or blocks the staff bug-report/help popout path when the toolbar developer menu is enabled
- restores local user flags when the plugin stops

## Settings

`Toolbar developer menu`

- shows Discord's developer toolbar/menu controls near the Help button
- may require reloading Discord if the toolbar does not update immediately

`DevTools shortcut`

- read-only display of Discord's built-in shortcut
- macOS: `cmd + opt + O`
- Windows/Linux: `ctrl + alt + O`

## Limitations

- Server-side experiment behavior cannot be enabled locally.
- Discord runtime changes can break experiment store patches, dev links, or toolbar behavior.
- Disable the plugin to remove injected UI and restore patched local state.
