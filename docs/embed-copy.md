# EmbedCopy.plugin.js

[`EmbedCopy.plugin.js`](../EmbedCopy.plugin.js) adds an `EmbedCopy` submenu to Discord message context menus when the message contains at least one embed.

It can copy the selected or first detected embed as raw Discord JSON, Carl-bot JSON, or a Discohook webhook payload.

## Menu Actions

- `Copy Raw Embed`
- `Copy Carl Embed`
- `Copy Discohook Embed`

The menu only appears for messages where Discord exposes embed data.

## Raw Copy

Raw copy preserves the selected Discord embed object.

When `Raw Expose All` is enabled, Raw also includes every message detail the plugin can capture, including message body data, attachments, thread context, all embeds, selected embed index, and raw message flags.

When `Raw Expose All` is disabled, Raw follows the message-context and forum-thread toggles.

## Carl Copy

Carl copy converts the embed into Carl-bot-compatible `!cembed` / `!ecembed` JSON.

It focuses on embed body fields only. Message body fields such as normal message text, webhook username, avatar URL, thread name, and thread ID are not exported for Carl.

## Discohook Copy

Discohook copy converts one or more embeds into a Discohook-compatible webhook payload.

Converted Discohook payloads omit suppress flag output. The `.org` target also omits `thread_id` for legacy import compatibility.

## Settings

`Raw Expose All`

- default: off
- when on, Raw copies all captured message data without filters
- when off, Raw follows the message-context and forum-thread gates

`Discohook > Include message context`

- message body fields: `content`, `author`, `username`, `avatar_url`, `id`, `channel_id`, `guild_id`, `attachments`
- mainly useful for Discohook webhook payloads
- also affects filtered Raw output when `Raw Expose All` is off

`Discohook > Include forum thread fields`

- adds forum thread fields when Discord exposes them
- `thread_name` is for creating a forum post
- `thread_id` is for editing an existing thread
- also affects filtered Raw output when `Raw Expose All` is off

`Discohook > Discohook target`

- `discohook.app` includes `thread_id` when forum thread fields are enabled
- `discohook.org` omits `thread_id`

## Field Coverage

Embed conversion covers the common Discord embed fields:

- title, description, URL, timestamp, color
- author name, URL, and icon URL
- footer text and icon URL
- image and thumbnail URL
- fields with `name`, `value`, and `inline`
- provider/video metadata where useful for Discohook

Attachment-backed media URLs are resolved from available URL/proxy URL fields when Discord exposes them.
