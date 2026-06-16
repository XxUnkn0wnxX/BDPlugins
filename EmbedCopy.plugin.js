/**
 * @name EmbedCopy
 * @author openAI
 * @version 1.0.3
 * @description Adds message embed copy actions for raw Discord, Carl-bot, and Discohook JSON formats.
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/EmbedCopy.plugin.js
 */

"use strict";

const PLUGIN_NAME = "EmbedCopy";
const SETTING_RAW_EXPOSE_ALL = "rawExposeAll";
const SETTING_INCLUDE_MESSAGE_CONTEXT = "includeMessageContext";
const SETTING_INCLUDE_FORUM_THREAD = "includeForumThread";
const SETTING_DISCOHOOK_TARGET = "discohookTarget";
const DISCOHOOK_TARGET_APP = "app";
const DISCOHOOK_TARGET_ORG = "org";
const DEFAULT_SETTINGS = {
    [SETTING_RAW_EXPOSE_ALL]: false,
    [SETTING_INCLUDE_MESSAGE_CONTEXT]: false,
    [SETTING_INCLUDE_FORUM_THREAD]: false,
    [SETTING_DISCOHOOK_TARGET]: DISCOHOOK_TARGET_APP
};

module.exports = class EmbedCopy {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || PLUGIN_NAME;
        this.version = this.meta.version || "1.0.3";
        this.unpatchMessageMenu = null;
        this.settings = {...DEFAULT_SETTINGS};
    }

    start() {
        try {
            this.settings = this.loadSettings();
            this.showChangelogIfNeeded();
            this.patchMessageMenu();
        }
        catch (error) {
            this.reportError("Failed to start.", error);
            this.stop();
        }
    }

    getSettingsPanel() {
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...this.settings
        };

        const panel = BdApi.UI.buildSettingsPanel({
            settings: [
                {
                    type: "switch",
                    id: SETTING_RAW_EXPOSE_ALL,
                    name: "Raw Expose All",
                    note: "Raw copies all captured message data, including flags, without filters.",
                    value: this.settings[SETTING_RAW_EXPOSE_ALL]
                },
                {
                    type: "switch",
                    id: SETTING_INCLUDE_MESSAGE_CONTEXT,
                    name: "Include message context",
                    note: "Add available message content and webhook profile data to Raw and Discohook copies.",
                    value: this.settings[SETTING_INCLUDE_MESSAGE_CONTEXT]
                },
                {
                    type: "category",
                    id: "discohook",
                    name: "Discohook",
                    collapsible: true,
                    shown: false,
                    settings: [
                        {
                            type: "switch",
                            id: SETTING_INCLUDE_FORUM_THREAD,
                            name: "Include forum thread fields",
                            note: "Thread Name creates a forum post. Thread ID edits an existing thread.",
                            value: this.settings[SETTING_INCLUDE_FORUM_THREAD]
                        },
                        {
                            type: "radio",
                            id: SETTING_DISCOHOOK_TARGET,
                            name: "Discohook target",
                            note: "Sets Discohook export compatibility when forum thread fields are enabled.",
                            value: this.settings[SETTING_DISCOHOOK_TARGET],
                            options: [
                                {
                                    name: "discohook.app",
                                    value: DISCOHOOK_TARGET_APP,
                                    desc: "Includes Thread ID when forum thread fields are enabled."
                                },
                                {
                                    name: "discohook.org",
                                    value: DISCOHOOK_TARGET_ORG,
                                    desc: "Omits Thread ID for legacy import compatibility."
                                }
                            ]
                        }
                    ]
                }
            ],
            onChange: (_, id, value) => this.updateSetting(id, value)
        });

        return panel;
    }

    loadSettings() {
        try {
            const stored = BdApi?.Data?.load?.(this.pluginName, "settings");
            return {
                ...DEFAULT_SETTINGS,
                ...(stored && typeof stored === "object" ? stored : {})
            };
        }
        catch (error) {
            this.reportError("Failed to load settings.", error);
            return {...DEFAULT_SETTINGS};
        }
    }

    saveSettings() {
        try {
            BdApi?.Data?.save?.(this.pluginName, "settings", this.settings);
        }
        catch (error) {
            this.reportError("Failed to save settings.", error);
        }
    }

    updateSetting(id, value) {
        this.settings = {
            ...this.settings,
            [id]: value
        };
        this.saveSettings();
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
                        "Added optional message and forum thread context settings for Raw and Discohook copies.",
                        "Added Raw Expose All for full raw message dumps.",
                        "Grouped Discohook options and omitted suppress flag output from converted templates."
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
                const messageContext = this.getMessageContext(props?.message, props);
                const embeds = messageContext.embeds;
                if (!embeds.length) return menu;

                const menuGroup = this.findMessageActionGroup(menu);
                if (!menuGroup) return menu;

                const selectedEmbed = this.resolveSelectedEmbed(props, embeds) ?? embeds[0];
                const buttonIndex = this.findMenuItemIndex(menuGroup, "copy-message");
                const existingEmbedCopyIndex = this.findMenuItemIndex(menuGroup, "embed-copy");

                if (existingEmbedCopyIndex >= 0) {
                    if (buttonIndex >= 0) {
                        this.rebuildEmbedCopyPlacement(menuGroup, contextMenu, selectedEmbed, embeds, messageContext, existingEmbedCopyIndex);
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
                    contextMenu.buildMenuChildren(this.buildEmbedCopyMenuBlock(selectedEmbed, embeds, messageContext))
                );
            }
            catch (error) {
                this.reportError("Failed to patch a message context menu.", error);
            }

            return menu;
        });
    }

    getMessageContext(message, props = {}) {
        const storeMessage = this.getStoreMessage(message, props);
        const sourceMessage = storeMessage || message || {};
        const storeEmbeds = this.toEmbedArray(storeMessage?.embeds);
        const directEmbeds = this.toEmbedArray(message?.embeds);

        return {
            message: sourceMessage,
            props,
            embeds: storeEmbeds.length ? storeEmbeds : directEmbeds,
            content: this.pickString(sourceMessage, ["content", "rawContent"]),
            author: sourceMessage?.author || message?.author,
            channel: props?.channel || sourceMessage?.channel,
            attachments: this.toArrayLike(sourceMessage?.attachments || message?.attachments),
            flags: this.normalizeInteger(this.pickValue(sourceMessage, ["flags"]))
        };
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

    toArrayLike(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(item => item && typeof item === "object");
        if (typeof value.toArray === "function") return this.toArrayLike(value.toArray());
        if (typeof value.values === "function") return this.toArrayLike(Array.from(value.values()));

        if (typeof value.length === "number") {
            const values = [];

            for (let index = 0; index < value.length; index++) {
                const item = value[index];
                if (item && typeof item === "object") values.push(item);
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

    rebuildEmbedCopyPlacement(group, contextMenu, selectedEmbed, embeds, messageContext, existingIndex) {
        group.splice(existingIndex, 1);

        const buttonIndex = this.findMenuItemIndex(group, "copy-message");
        if (buttonIndex < 0) return;

        group.splice(
            buttonIndex + 1,
            0,
            contextMenu.buildMenuChildren(this.buildEmbedCopyMenuBlock(selectedEmbed, embeds, messageContext))
        );
    }

    buildEmbedCopyMenuBlock(selectedEmbed, embeds, messageContext) {
        return [
            {
                type: "separator"
            },
            this.buildEmbedCopyMenuItem(selectedEmbed, embeds, messageContext),
            {
                type: "separator"
            }
        ];
    }

    buildEmbedCopyMenuItem(selectedEmbed, embeds, messageContext) {
        return {
            id: "embed-copy",
            label: "EmbedCopy",
            type: "submenu",
            items: [
                {
                    id: "embed-copy-raw",
                    label: "Copy Raw Embed",
                    action: () => this.copyRawEmbed(selectedEmbed, messageContext)
                },
                {
                    id: "embed-copy-carl",
                    label: "Copy Carl Embed",
                    action: () => this.copyCarlEmbed(selectedEmbed)
                },
                {
                    id: "embed-copy-discohook",
                    label: "Copy Discohook Embed",
                    action: () => this.copyDiscohookEmbeds(embeds, messageContext)
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

    copyRawEmbed(embed, messageContext) {
        const payload = this.buildRawMessagePayload(embed, messageContext);
        this.copyJson(payload, payload === embed ? "Copied raw embed." : "Copied raw embed context.");
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

    copyDiscohookEmbeds(embeds, messageContext) {
        const payload = {
            embeds: embeds.map(embed => this.normalizeEmbed(embed, {
                keepReadOnlyMediaData: false,
                includeType: false,
                includeProvider: true,
                includeVideo: true,
                includeFlags: false,
                attachments: messageContext?.attachments
            })).filter(embed => Object.keys(embed).length)
        };

        if (this.shouldCopyDiscohookMessageContext()) {
            this.applyDiscohookMessageContext(payload, messageContext);
        }

        this.copyJson(payload, payload.embeds.length > 1 ? "Copied Discohook embeds JSON." : "Copied Discohook embed JSON.");
    }

    buildRawMessagePayload(selectedEmbed, messageContext) {
        const exposeAll = this.settings[SETTING_RAW_EXPOSE_ALL];
        const payload = {
            embed: selectedEmbed
        };

        const context = this.normalizeRawMessageContext(messageContext);
        if (Object.keys(context).length) payload.message = context;

        const embeds = this.toEmbedArray(messageContext?.embeds);
        if (exposeAll && embeds.length > 1) payload.embeds = embeds;

        const selectedIndex = embeds.indexOf(selectedEmbed);
        if (exposeAll && selectedIndex >= 0) payload.selected_embed_index = selectedIndex;

        if (!Object.keys(context).length && (!exposeAll || embeds.length <= 1)) return selectedEmbed;

        return payload;
    }

    normalizeRawMessageContext(messageContext) {
        const context = {};
        const message = messageContext?.message || {};
        const exposeAll = this.settings[SETTING_RAW_EXPOSE_ALL];
        const includeMessageContext = exposeAll || this.settings[SETTING_INCLUDE_MESSAGE_CONTEXT];
        const includeForumThread = exposeAll || this.settings[SETTING_INCLUDE_FORUM_THREAD];
        const author = this.normalizeWebhookProfile(messageContext);
        const thread = this.normalizeThreadContext(messageContext);
        const flags = this.normalizeInteger(this.pickValue(messageContext, ["flags"]));
        const attachments = this.normalizeAttachments(messageContext?.attachments);

        if (includeMessageContext) {
            this.assignIfPresent(context, "id", this.pickString(message, ["id"]));
            this.assignIfPresent(context, "channel_id", this.pickString(message, ["channel_id", "channelId"]));
            this.assignIfPresent(context, "guild_id", this.pickString(message, ["guild_id", "guildId"]));
            this.assignIfPresent(context, "content", messageContext?.content);
            this.assignObjectIfPresent(context, "author", author);
            if (attachments.length) context.attachments = attachments;
        }

        if (includeForumThread) this.assignObjectIfPresent(context, "thread", thread);
        if (exposeAll && flags !== null) context.flags = flags;

        return context;
    }

    applyDiscohookMessageContext(payload, messageContext) {
        const includeMessageContext = this.settings[SETTING_INCLUDE_MESSAGE_CONTEXT];
        const profile = this.normalizeWebhookProfile(messageContext);
        const thread = this.settings[SETTING_INCLUDE_FORUM_THREAD]
            ? this.normalizeThreadContext(messageContext)
            : {};

        if (includeMessageContext) {
            this.assignIfPresent(payload, "content", messageContext?.content);
            this.assignIfPresent(payload, "username", profile.name);
            this.assignIfPresent(payload, "avatar_url", profile.avatar_url);
        }

        this.assignIfPresent(payload, "thread_name", thread.name);
        if (this.settings[SETTING_DISCOHOOK_TARGET] !== DISCOHOOK_TARGET_ORG) {
            this.assignIfPresent(payload, "thread_id", thread.id);
        }
    }

    shouldCopyDiscohookMessageContext() {
        return Boolean(this.settings[SETTING_INCLUDE_MESSAGE_CONTEXT] || this.settings[SETTING_INCLUDE_FORUM_THREAD]);
    }

    normalizeWebhookProfile(messageContext) {
        const author = messageContext?.author || {};
        const normalized = {};
        const name = this.pickString(author, ["username", "globalName", "global_name", "displayName", "name"]);
        const avatarUrl = this.resolveAuthorAvatarUrl(author);

        this.assignIfPresent(normalized, "name", name);
        this.assignIfPresent(normalized, "avatar_url", avatarUrl);

        return normalized;
    }

    resolveAuthorAvatarUrl(author) {
        if (!author || typeof author !== "object") return null;

        const direct = this.pickString(author, ["avatar_url", "avatarURL", "avatarUrl", "avatar"]);
        if (this.isUsableUrl(direct)) return direct;

        try {
            const getter = author.getAvatarURL || author.getAvatarUrl;
            if (typeof getter === "function") {
                const avatarUrl = getter.call(author);
                if (this.isUsableUrl(avatarUrl)) return avatarUrl;
            }
        }
        catch {}

        return null;
    }

    normalizeThreadContext(messageContext) {
        const message = messageContext?.message || {};
        const channel = messageContext?.channel || {};
        const thread = message?.thread || messageContext?.props?.thread || channel?.thread || {};
        const normalized = {};
        const channelIsThread = this.channelLooksLikeThread(channel);
        const name = this.pickString(thread, ["name"])
            || (channelIsThread ? this.pickString(channel, ["name", "rawName"]) : null);
        const id = this.pickString(message, ["thread_id", "threadId"])
            || this.pickString(thread, ["id"])
            || (channelIsThread ? this.pickString(channel, ["id"]) : null);

        this.assignIfPresent(normalized, "name", name);
        this.assignIfPresent(normalized, "id", id);

        return normalized;
    }

    channelLooksLikeThread(channel) {
        if (!channel || typeof channel !== "object") return false;

        try {
            if (typeof channel.isThread === "function" && channel.isThread()) return true;
        }
        catch {}

        const type = this.normalizeInteger(channel.type);
        return Boolean(channel.threadMetadata || channel.parent_id || channel.parentId || [10, 11, 12].includes(type));
    }

    normalizeAttachments(attachments) {
        return this.toArrayLike(attachments).map(attachment => {
            const normalized = {};
            const filename = this.pickString(attachment, ["filename", "name"]);
            const url = this.pickUsableUrl([
                this.pickString(attachment, ["url", "href", "src"]),
                this.pickString(attachment, ["proxy_url", "proxyURL", "proxyUrl"])
            ]);
            const size = this.normalizeInteger(this.pickValue(attachment, ["size"]));
            const contentType = this.pickString(attachment, ["content_type", "contentType"]);

            this.assignIfPresent(normalized, "id", this.pickString(attachment, ["id"]));
            this.assignIfPresent(normalized, "filename", filename);
            this.assignIfPresent(normalized, "url", url);
            if (size !== null) normalized.size = size;
            this.assignIfPresent(normalized, "content_type", contentType);

            return Object.keys(normalized).length ? normalized : null;
        }).filter(Boolean);
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
        const iconUrl = this.resolveTemplateUrl(
            this.pickString(footer, ["icon_url", "iconURL", "iconUrl"]),
            this.pickString(footer, ["proxy_icon_url", "proxyIconURL", "proxyIconUrl"]),
            options.attachments
        );
        const proxyIconUrl = this.pickString(footer, ["proxy_icon_url", "proxyIconURL", "proxyIconUrl"]);

        this.assignIfPresent(normalized, "text", text);
        this.assignIfPresent(normalized, "icon_url", iconUrl);
        if (options.keepReadOnlyMediaData) this.assignIfPresent(normalized, "proxy_icon_url", proxyIconUrl);

        return normalized;
    }

    normalizeMedia(media, options) {
        if (!media || typeof media !== "object") return null;

        const normalized = {};
        const rawUrl = this.pickString(media, ["url", "src", "href"]);
        const proxyUrl = this.pickString(media, ["proxy_url", "proxyURL", "proxyUrl"]);
        const url = this.resolveTemplateUrl(rawUrl, proxyUrl, options.attachments);
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

    resolveTemplateUrl(url, proxyUrl, attachments = []) {
        const attachmentUrl = this.resolveAttachmentUrl(url, attachments);
        return this.pickUsableUrl([url, attachmentUrl, proxyUrl]);
    }

    resolveAttachmentUrl(url, attachments = []) {
        if (typeof url !== "string" || !url.startsWith("attachment://")) return null;

        const attachmentName = this.normalizeFileName(url.slice("attachment://".length));
        if (!attachmentName) return null;

        const attachment = this.toArrayLike(attachments).find(item => {
            const fileName = this.normalizeFileName(this.pickString(item, ["filename", "name"]));
            return fileName && fileName === attachmentName;
        });
        if (!attachment) return null;

        return this.pickUsableUrl([
            this.pickString(attachment, ["url", "href", "src"]),
            this.pickString(attachment, ["proxy_url", "proxyURL", "proxyUrl"])
        ]);
    }

    normalizeFileName(value) {
        if (typeof value !== "string") return null;

        try {
            return decodeURIComponent(value).trim().toLowerCase();
        }
        catch {
            return value.trim().toLowerCase();
        }
    }

    pickUsableUrl(urls) {
        for (const url of urls) {
            if (this.isUsableUrl(url)) return url;
        }

        return null;
    }

    isUsableUrl(url) {
        return typeof url === "string" && /^https?:\/\//i.test(url.trim());
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
        const iconUrl = this.resolveTemplateUrl(
            this.pickString(author, ["icon_url", "iconURL", "iconUrl"]),
            this.pickString(author, ["proxy_icon_url", "proxyIconURL", "proxyIconUrl"]),
            options.attachments
        );
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
