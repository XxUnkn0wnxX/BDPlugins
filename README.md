# BDPlugins

Vibe-coded personal BetterDiscord plugins.

Repo layout:
- BetterDiscord plugins live at the repository root as `*.plugin.js`
- Plugin documentation lives under [`docs/`](docs/)

## Plugins

- [`BDConsoleLogger.plugin.js`](BDConsoleLogger.plugin.js) - Write live Discord renderer console output to BetterDiscord's channel-specific `console.log`. [Docs](docs/bd-console-logger.md)
- [`EmbedCopy.plugin.js`](EmbedCopy.plugin.js) - Copy Discord embeds as raw Discord JSON, Carl-bot JSON, or Discohook webhook payloads. [Docs](docs/embed-copy.md)
- [`Experiments.plugin.js`](Experiments.plugin.js) - Enable Discord experiment access and developer experiment UI in BetterDiscord. [Docs](docs/experiments.md)
- [`JumpToTop.plugin.js`](JumpToTop.plugin.js) - Add a channel header button that jumps to the first available message. [Docs](docs/jump-to-top.md)

These plugins target Discord/BetterDiscord runtime internals. If Discord changes its Webpack modules or context menu shape, a plugin may need an update.
