/**
 * @name EmbedCopy
 * @author openAI
 * @version 1.0.1
 * @description Adds message embed copy actions for raw Discord, Carl-bot, and Discohook JSON formats.
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/EmbedCopy.plugin.js
 */

"use strict";

const PLUGIN_NAME = "EmbedCopy";

module.exports = class EmbedCopy {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || PLUGIN_NAME;
        this.version = this.meta.version || "1.0.1";
        this.unpatchMessageMenu = null;
    }

    start() {
        try {
            this.showChangelogIfNeeded();
            this.patchMessageMenu();
        }
        catch (error) {
            this.reportError("Failed to start.", error);
            this.stop();
        }
    }

    stop() {
        try {
            this.unpatchMessageMenu?.();
        }
        catch (error) {
            this.reportError("Failed to unpatch the message context menu.", error);
        }

        this.unpatchMessageMenu = null;

        try {
            BdApi?.Patcher?.unpatchAll?.(this.pluginName);
        }
        catch {}
    }

    getChangelog() {
        return {
            title: `${this.pluginName} has been updated!`,
            subtitle: `v${this.version}`,
            changes: [
                {
                    title: "Summary",
                    type: "progress",
                    items: [
                        "Added Raw, Carl, and Discohook embed copy actions for messages with embeds.",
                        "Aligned EmbedCopy placement under Copier with separated menu spacing.",
                        "Cleaned Carl and Discohook exports for template import compatibility."
                    ]
                }
            ]
        };
    }

    showChangelogIfNeeded() {
        try {
            const data = BdApi?.Data;
            const ui = BdApi?.UI;
            if (!data?.load || !data?.save || !ui?.showChangelogModal) return;

            if (data.load(this.pluginName, "version") === this.version) return;

            ui.showChangelogModal(this.getChangelog());
            data.save(this.pluginName, "version", this.version);
        }
        catch (error) {
            this.reportError("Failed to show changelog.", error);
        }
    }

    patchMessageMenu() {
        if (this.unpatchMessageMenu) return;

        const contextMenu = BdApi?.ContextMenu;
        if (!contextMenu?.patch || !contextMenu?.buildMenuChildren) {
            throw new Error("BdApi.ContextMenu is not available.");
        }

        this.unpatchMessageMenu = contextMenu.patch("message", (menu, props) => {
            try {
                const message = props?.message;
                const embeds = this.getMessageEmbeds(message, props);
                if (!embeds.length) return menu;

                const menuGroup = this.findMessageActionGroup(menu);
                if (!menuGroup) return menu;

                const selectedEmbed = this.resolveSelectedEmbed(props, embeds) ?? embeds[0];
                const buttonIndex = this.findMenuItemIndex(menuGroup, "copy-message");
                const existingEmbedCopyIndex = this.findMenuItemIndex(menuGroup, "embed-copy");

                if (existingEmbedCopyIndex >= 0) {
                    if (buttonIndex >= 0) {
                        this.rebuildEmbedCopyPlacement(menuGroup, contextMenu, selectedEmbed, embeds, existingEmbedCopyIndex);
                    }

                    return menu;
                }

                const fallbackIndex = this.findFallbackInsertIndex(menuGroup);
                const insertIndex = buttonIndex >= 0
                    ? buttonIndex + 1
                    : fallbackIndex;
                menuGroup.splice(
                    insertIndex,
                    0,
                    contextMenu.buildMenuChildren(this.buildEmbedCopyMenuBlock(selectedEmbed, embeds))
                );
            }
            catch (error) {
                this.reportError("Failed to patch a message context menu.", error);
            }

            return menu;
        });
    }

    getMessageEmbeds(message, props = {}) {
        const directEmbeds = this.toEmbedArray(message?.embeds);
        if (directEmbeds.length) return directEmbeds;

        const storeMessage = this.getStoreMessage(message, props);
        return this.toEmbedArray(storeMessage?.embeds);
    }

    toEmbedArray(embeds) {
        if (!embeds) return [];

        if (Array.isArray(embeds)) {
            return embeds.filter(embed => embed && typeof embed === "object");
        }

        if (typeof embeds.toArray === "function") {
            return this.toEmbedArray(embeds.toArray());
        }

        if (typeof embeds.values === "function") {
            return this.toEmbedArray(Array.from(embeds.values()));
        }

        if (typeof embeds.length === "number") {
            const values = [];

            for (let index = 0; index < embeds.length; index++) {
                const embed = embeds[index];
                if (embed && typeof embed === "object") values.push(embed);
            }

            return values;
        }

        return [];
    }

    getStoreMessage(message, props = {}) {
        try {
            const messageStore = this.getMessageStore();
            const channelId = message?.channel_id || message?.channelId || props?.channel?.id;
            const messageId = message?.id;

            if (!messageStore?.getMessage || !channelId || !messageId) return null;

            return messageStore.getMessage(channelId, messageId);
        }
        catch (error) {
            this.reportError("Failed to read message embeds from MessageStore.", error);
            return null;
        }
    }

    getMessageStore() {
        if (this.messageStore) return this.messageStore;

        const webpack = BdApi?.Webpack;
        this.messageStore = webpack?.getStore?.("MessageStore")
            || webpack?.getModule?.(module => module?._dispatchToken && module.getName?.() === "MessageStore");

        return this.messageStore;
    }

    findMessageActionGroup(menu) {
        return this.findGroupByChildId(menu, "delete") || this.findGroupByChildId(menu, "report");
    }

    findMessageActionIndex(group) {
        return group.findIndex(item => this.nodeHasMenuId(item, "delete") || this.nodeHasMenuId(item, "report"));
    }

    findFallbackInsertIndex(group) {
        const reportIndex = group.findIndex(item => {
            const id = this.findFirstMenuId(item);
            return this.menuIdMatches(id, "report");
        });
        if (reportIndex >= 0) return reportIndex;

        const deleteIndex = group.findIndex(item => {
            const id = this.findFirstMenuId(item);
            return this.menuIdMatches(id, "delete");
        });
        if (deleteIndex >= 0) return deleteIndex + 1;

        return group.length;
    }

    findMenuItemIndex(group, id) {
        return group.findIndex(item => this.nodeHasMenuId(item, id));
    }

    rebuildEmbedCopyPlacement(group, contextMenu, selectedEmbed, embeds, existingIndex) {
        group.splice(existingIndex, 1);

        const buttonIndex = this.findMenuItemIndex(group, "copy-message");
        if (buttonIndex < 0) return;

        group.splice(
            buttonIndex + 1,
            0,
            contextMenu.buildMenuChildren(this.buildEmbedCopyMenuBlock(selectedEmbed, embeds))
        );
    }

    buildEmbedCopyMenuBlock(selectedEmbed, embeds) {
        return [
            {
                type: "separator"
            },
            this.buildEmbedCopyMenuItem(selectedEmbed, embeds),
            {
                type: "separator"
            }
        ];
    }

    buildEmbedCopyMenuItem(selectedEmbed, embeds) {
        return {
            id: "embed-copy",
            label: "EmbedCopy",
            type: "submenu",
            items: [
                {
                    id: "embed-copy-raw",
                    label: "Copy Raw Embed",
                    action: () => this.copyRawEmbed(selectedEmbed)
                },
                {
                    id: "embed-copy-carl",
                    label: "Copy Carl Embed",
                    action: () => this.copyCarlEmbed(selectedEmbed)
                },
                {
                    id: "embed-copy-discohook",
                    label: "Copy Discohook Embed",
                    action: () => this.copyDiscohookEmbeds(embeds)
                }
            ]
        };
    }

    findGroupByChildId(node, id) {
        const children = Array.isArray(node) ? node : this.asArray(node?.props?.children);

        if (children.some(child => this.menuIdMatches(child?.props?.id, id))) return children;

        for (const child of children) {
            const found = this.findGroupByChildId(child, id);
            if (found) return found;
        }

        return null;
    }

    nodeHasMenuId(node, id) {
        if (!node || typeof node !== "object") return false;
        if (Array.isArray(node)) return node.some(child => this.nodeHasMenuId(child, id));
        if (this.menuIdMatches(node?.props?.id, id)) return true;

        return this.asArray(node?.props?.children).some(child => this.nodeHasMenuId(child, id));
    }

    findFirstMenuId(node) {
        if (!node || typeof node !== "object") return null;
        if (Array.isArray(node)) {
            for (const child of node) {
                const id = this.findFirstMenuId(child);
                if (id) return id;
            }

            return null;
        }
        if (typeof node?.props?.id === "string") return node.props.id;

        for (const child of this.asArray(node?.props?.children)) {
            const id = this.findFirstMenuId(child);
            if (id) return id;
        }

        return null;
    }

    menuIdMatches(actual, expected) {
        if (typeof actual !== "string") return false;
        return actual === expected || actual === `message-${expected}`;
    }

    resolveSelectedEmbed(props, embeds) {
        const target = props?.target instanceof HTMLElement
            ? props.target
            : props?.rawTarget instanceof HTMLElement
                ? props.rawTarget
                : null;
        if (!target) return null;

        const embedElement = target.closest("[class*='embed']");
        const messageElement = target.closest("[id^='chat-messages-'], [class*='message']");
        if (!embedElement || !messageElement) return null;

        const embedElements = Array.from(messageElement.querySelectorAll("[class*='embed']")).filter(element => {
            return element instanceof HTMLElement && !element.closest("[role='menu']");
        });
        const index = embedElements.indexOf(embedElement);

        return index >= 0 ? embeds[index] : null;
    }

    copyRawEmbed(embed) {
        this.copyJson(embed, "Copied raw embed.");
    }

    copyCarlEmbed(embed) {
        const payload = this.normalizeEmbed(embed, {
            keepReadOnlyMediaData: false,
            includeType: false,
            includeProvider: false,
            includeVideo: false,
            includeFlags: false
        });

        this.copyJson(payload, "Copied Carl embed JSON.");
    }

    copyDiscohookEmbeds(embeds) {
        const payload = {
            embeds: embeds.map(embed => this.normalizeEmbed(embed, {
                keepReadOnlyMediaData: false,
                includeType: false,
                includeProvider: true,
                includeVideo: true,
                includeFlags: true
            })).filter(embed => Object.keys(embed).length)
        };

        this.copyJson(payload, payload.embeds.length > 1 ? "Copied Discohook embeds JSON." : "Copied Discohook embed JSON.");
    }

    normalizeEmbed(embed, options = {}) {
        const normalized = {};
        const title = this.pickString(embed, ["title", "rawTitle"]);
        const description = this.pickString(embed, ["description", "rawDescription"]);
        const url = this.pickString(embed, ["url", "titleUrl", "titleURL"]);
        const timestamp = this.normalizeTimestamp(this.pickValue(embed, ["timestamp"]));
        const color = this.normalizeColor(this.pickValue(embed, ["color"]));
        const footer = this.normalizeFooter(embed?.footer, options);
        const image = this.normalizeMedia(embed?.image, options);
        const thumbnail = this.normalizeMedia(embed?.thumbnail, options);
        const video = this.normalizeMedia(embed?.video, options);
        const provider = this.normalizeProvider(embed?.provider);
        const author = this.normalizeAuthor(embed?.author, options);
        const fields = this.normalizeFields(embed?.fields);
        const type = this.pickString(embed, ["type"]);
        const flags = this.normalizeInteger(this.pickValue(embed, ["flags"]));

        this.assignIfPresent(normalized, "title", title);
        if (options.includeType && type) normalized.type = type;
        this.assignIfPresent(normalized, "description", description);
        this.assignIfPresent(normalized, "url", url);
        if (timestamp) normalized.timestamp = timestamp;
        if (color !== null) normalized.color = color;
        this.assignObjectIfPresent(normalized, "footer", footer);
        this.assignObjectIfPresent(normalized, "image", image);
        this.assignObjectIfPresent(normalized, "thumbnail", thumbnail);
        if (options.includeVideo) this.assignObjectIfPresent(normalized, "video", video);
        if (options.includeProvider) this.assignObjectIfPresent(normalized, "provider", provider);
        this.assignObjectIfPresent(normalized, "author", author);
        if (fields.length) normalized.fields = fields;
        if (options.includeFlags && flags !== null) normalized.flags = flags;

        return normalized;
    }

    normalizeFooter(footer, options) {
        if (!footer || typeof footer !== "object") return null;

        const normalized = {};
        const text = this.pickString(footer, ["text", "rawText"]);
        const iconUrl = this.pickString(footer, ["icon_url", "iconURL", "iconUrl"]);
        const proxyIconUrl = this.pickString(footer, ["proxy_icon_url", "proxyIconURL", "proxyIconUrl"]);

        this.assignIfPresent(normalized, "text", text);
        this.assignIfPresent(normalized, "icon_url", iconUrl);
        if (options.keepReadOnlyMediaData) this.assignIfPresent(normalized, "proxy_icon_url", proxyIconUrl);

        return normalized;
    }

    normalizeMedia(media, options) {
        if (!media || typeof media !== "object") return null;

        const normalized = {};
        const url = this.pickString(media, ["url", "src", "href"]);
        const proxyUrl = this.pickString(media, ["proxy_url", "proxyURL", "proxyUrl"]);
        const contentType = this.pickString(media, ["content_type", "contentType"]);
        const placeholder = this.pickString(media, ["placeholder"]);
        const description = this.pickString(media, ["description", "alt", "altText"]);
        const height = this.normalizeInteger(this.pickValue(media, ["height"]));
        const width = this.normalizeInteger(this.pickValue(media, ["width"]));
        const placeholderVersion = this.normalizeInteger(this.pickValue(media, ["placeholder_version", "placeholderVersion"]));
        const flags = this.normalizeInteger(this.pickValue(media, ["flags"]));

        this.assignIfPresent(normalized, "url", url);

        if (options.keepReadOnlyMediaData) {
            this.assignIfPresent(normalized, "proxy_url", proxyUrl);
            if (height !== null) normalized.height = height;
            if (width !== null) normalized.width = width;
            this.assignIfPresent(normalized, "content_type", contentType);
            this.assignIfPresent(normalized, "placeholder", placeholder);
            if (placeholderVersion !== null) normalized.placeholder_version = placeholderVersion;
            this.assignIfPresent(normalized, "description", description);
            if (flags !== null) normalized.flags = flags;
        }

        return normalized;
    }

    normalizeProvider(provider) {
        if (!provider || typeof provider !== "object") return null;

        const normalized = {};
        const name = this.pickString(provider, ["name"]);
        const url = this.pickString(provider, ["url"]);

        this.assignIfPresent(normalized, "name", name);
        this.assignIfPresent(normalized, "url", url);

        return normalized;
    }

    normalizeAuthor(author, options) {
        if (!author || typeof author !== "object") return null;

        const normalized = {};
        const name = this.pickString(author, ["name", "rawName"]);
        const url = this.pickString(author, ["url"]);
        const iconUrl = this.pickString(author, ["icon_url", "iconURL", "iconUrl"]);
        const proxyIconUrl = this.pickString(author, ["proxy_icon_url", "proxyIconURL", "proxyIconUrl"]);

        this.assignIfPresent(normalized, "name", name);
        this.assignIfPresent(normalized, "url", url);
        this.assignIfPresent(normalized, "icon_url", iconUrl);
        if (options.keepReadOnlyMediaData) this.assignIfPresent(normalized, "proxy_icon_url", proxyIconUrl);

        return normalized;
    }

    normalizeFields(fields) {
        if (!Array.isArray(fields)) return [];

        return fields.map(field => {
            if (!field || typeof field !== "object") return null;

            const normalized = {};
            const name = this.pickString(field, ["name", "rawName"]);
            const value = this.pickString(field, ["value", "rawValue"]);

            this.assignIfPresent(normalized, "name", name);
            this.assignIfPresent(normalized, "value", value);
            if (typeof field.inline === "boolean") normalized.inline = field.inline;

            return normalized.name !== undefined && normalized.value !== undefined ? normalized : null;
        }).filter(Boolean);
    }

    normalizeColor(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value & 0xffffff;

        if (typeof value !== "string") return null;

        const trimmed = value.trim();
        const hex = trimmed.match(/^#?([0-9a-f]{6})$/i);
        if (hex) return Number.parseInt(hex[1], 16);

        const decimal = Number(trimmed);
        if (Number.isFinite(decimal)) return decimal & 0xffffff;

        const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
        if (rgb) return this.rgbToInteger(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));

        const hsla = trimmed.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*(?:calc\(var\(--saturation-factor,\s*1\)\s*\*\s*)?([\d.]+)%\)?\s*,\s*([\d.]+)%(?:\s*,\s*[\d.]+)?\s*\)$/i);
        if (hsla) return this.hslToInteger(Number(hsla[1]), Number(hsla[2]), Number(hsla[3]));

        return null;
    }

    normalizeTimestamp(value) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
        if (typeof value !== "string") return null;

        const timestamp = value.trim();
        if (!timestamp) return null;

        const parsed = Date.parse(timestamp);
        return Number.isNaN(parsed) ? timestamp : new Date(parsed).toISOString();
    }

    normalizeInteger(value) {
        if (typeof value === "number" && Number.isInteger(value)) return value;
        if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);

        return null;
    }

    hslToInteger(hue, saturation, lightness) {
        const h = (((hue % 360) + 360) % 360) / 360;
        const s = Math.max(0, Math.min(100, saturation)) / 100;
        const l = Math.max(0, Math.min(100, lightness)) / 100;

        if (s === 0) {
            const gray = Math.round(l * 255);
            return this.rgbToInteger(gray, gray, gray);
        }

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const r = this.hueToRgb(p, q, h + 1 / 3);
        const g = this.hueToRgb(p, q, h);
        const b = this.hueToRgb(p, q, h - 1 / 3);

        return this.rgbToInteger(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
    }

    hueToRgb(p, q, t) {
        let value = t;
        if (value < 0) value += 1;
        if (value > 1) value -= 1;
        if (value < 1 / 6) return p + (q - p) * 6 * value;
        if (value < 1 / 2) return q;
        if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;

        return p;
    }

    rgbToInteger(red, green, blue) {
        const r = Math.max(0, Math.min(255, Math.round(red)));
        const g = Math.max(0, Math.min(255, Math.round(green)));
        const b = Math.max(0, Math.min(255, Math.round(blue)));

        return (r << 16) + (g << 8) + b;
    }

    pickValue(object, keys) {
        if (!object || typeof object !== "object") return undefined;

        for (const key of keys) {
            const value = object[key];
            if (value !== undefined && value !== null) return value;
        }

        return undefined;
    }

    pickString(object, keys) {
        const value = this.pickValue(object, keys);
        if (value === undefined || value === null) return null;

        const string = String(value);
        return string.length ? string : null;
    }

    assignIfPresent(target, key, value) {
        if (value !== null && value !== undefined) target[key] = value;
    }

    assignObjectIfPresent(target, key, value) {
        if (value && Object.keys(value).length) target[key] = value;
    }

    asArray(value) {
        if (Array.isArray(value)) return value;
        return value === undefined || value === null ? [] : [value];
    }

    copyJson(payload, successMessage) {
        try {
            this.copyText(JSON.stringify(payload, null, 4));
            this.showToast(successMessage, "success");
        }
        catch (error) {
            this.reportError("Failed to copy embed JSON.", error);
            this.showToast("Failed to copy embed JSON.", "error");
        }
    }

    copyText(text) {
        if (globalThis.DiscordNative?.clipboard?.copy) {
            DiscordNative.clipboard.copy(text);
            return;
        }

        navigator?.clipboard?.writeText?.(text);
    }

    showToast(message, type = "info") {
        try {
            BdApi?.UI?.showToast?.(message, {type});
        }
        catch {}
    }

    reportError(message, error) {
        console.error(`[${this.pluginName}] ${message}`, error);
    }
};
