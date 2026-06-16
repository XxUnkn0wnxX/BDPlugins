# BDConsoleLogger.plugin.js

[`BDConsoleLogger.plugin.js`](../BDConsoleLogger.plugin.js) writes live Discord renderer console output to BetterDiscord's channel-specific `console.log` file beside `debug.log`.

## What It Does

- resolves the active Discord release channel
- writes to BetterDiscord's `console.log` for Stable, PTB, or Canary
- captures `console.*` calls after the plugin starts
- captures window `error` and `unhandledrejection` events
- captures process warnings, unhandled rejections, and uncaught exceptions when available
- falls back to console method patching if inspector capture is unavailable

## Log Paths

Depending on the active Discord channel, output is written to:

```text
BetterDiscord/data/stable/console.log
BetterDiscord/data/ptb/console.log
BetterDiscord/data/canary/console.log
```

The plugin uses BetterDiscord's `BETTERDISCORD_DATA_PATH` runtime path to find the correct data folder.

## What It Does Not Capture

This is not a full DevTools mirror.

It does not reliably capture every Chromium/browser internal warning, every resource loading message, or raw commands typed into the DevTools console UI.

## Good To Know

- The plugin appends a start marker and end marker to the log.
- Circular objects are guarded while serializing console output.
- The plugin restores patched console methods when stopped.
