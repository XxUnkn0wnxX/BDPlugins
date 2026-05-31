/**
 * @name Experiments
 * @author openAI
 * @version 1.3.2
 * @description Enables Discord experiments and developer-only experiment UI in BetterDiscord, modeled after Equicord's Experiments plugin.
 * @license AGPL-3.0-or-later
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/Experiments.plugin.js
 */

"use strict";

const PLUGIN_NAME = "Experiments";
const DEV_FLAG = 1;
const BUG_REPORTER_EXPERIMENT = "2026-01-bug-reporter";
const STAFF_HELP_POPOUT = "staff-help-popout";

module.exports = class Experiments {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || PLUGIN_NAME;
        this.version = this.meta.version || "1.3.2";
        this.styleId = `${this.pluginName}-style`;
        this.warningId = `${this.pluginName}-warning-card`;
        this.serverAssignmentTargets = new WeakSet();
        this.lazyGuardAbortController = null;
        this.originalFlags = new WeakMap();
        this.forcedMembers = [];
        this.userStore = null;
        this.dispatcher = null;
        this.observer = null;
        this.ensureTimer = null;
        this.isRunning = false;
        this.ensureQueued = false;
        this.isEnsuring = false;
        this.staffHelpClickEvents = ["pointerdown", "mousedown", "click", "keydown"];
        this.staffHelpClickHandler = event => this.handleStaffHelpInteraction(event);
    }

    start() {
        try {
            this.isRunning = true;
            this.showChangelogIfNeeded();
            this.injectStyles();
            this.resolveInternals();
            this.patchUserStore();
            this.patchExperimentStores();
            this.patchExperimentGuards();
            this.startStaffHelpClickBlocker();
            this.ensureExperiments("start");
            this.startDomObserver();
            this.queueEnsureWarningCard();
            this.showToast("Experiments enabled.", "success");
        }
        catch (error) {
            this.reportError("Failed to start.", error);
            this.stop();
        }
    }

    stop() {
        this.isRunning = false;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.ensureTimer) {
            window.clearInterval(this.ensureTimer);
            this.ensureTimer = null;
        }

        this.stopStaffHelpClickBlocker();

        try {
            BdApi?.Patcher?.unpatchAll?.(this.pluginName);
        }
        catch {}

        this.lazyGuardAbortController?.abort?.();
        this.lazyGuardAbortController = null;
        this.restoreForcedMembers();
        this.restoreUserFlags();
        this.flushExperimentStores();
        this.removeWarningCard();
        this.removeStyles();
        this.ensureQueued = false;
        this.isEnsuring = false;
        this.showToast("Experiments disabled.", "info");
    }

    getChangelog() {
        return {
            title: `${this.pluginName} has been updated!`,
            subtitle: `v${this.version}`,
            changes: [
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added a BetterDiscord-native Experiments plugin based on Equicord's experiment access behavior.",
                        "Added local developer access patches, experiment store refreshes, and startup self-healing.",
                        "Added an experiments-page warning card and staff bug-report popout hiding."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added a scoped bug-reporter experiment bucket patch to expose Discord's own toolbar developer/bug-report menu path without scanning Webpack modules."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Blocked staff-help popout trigger clicks when Discord exposes the toolbar developer menu."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added BetterDiscord-owned runtime guards for experiment embed assignment lookups."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Added a getServerAssignment null guard for malformed experiment embed data."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Removed direct Webpack chunk push wrapping and avoided private plugin-library require access so other plugins can keep their module hooks stable."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Disabled unsupported source-factory rewriting until the experiment embed module can be ported with BetterDiscord-owned APIs only."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Stopped trying to redefine Discord's non-configurable isStaff and isStaffPersonal methods, which flooded debug.log with TypeError entries."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Stopped sending a synthetic OVERLAY_INITIALIZE payload to Discord's ExperimentStore; current Discord builds expect experiment-load state there."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Removed the Stage 1 Webpack discovery scanner so this plugin does not touch shared lookup paths or conflict with other plugins."
                    ]
                },
                {
                    title: "Notes",
                    type: "progress",
                    items: [
                        "Server-side experiment behavior still cannot be enabled locally.",
                        "Disable the plugin to restore the local user flags and remove injected UI."
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
            console.error(`[${this.pluginName}] Failed to show changelog.`, error);
        }
    }

    resolveInternals() {
        this.userStore = this.getStore("UserStore") || this.getWebpackModule(module => {
            return module?.getCurrentUser && module?.getUsers;
        }, {searchExports: true});

        this.dispatcher = this.userStore?._dispatcher || this.getWebpackModule(module => {
            return module?.dispatch && module?.subscribe && module?.unsubscribe;
        }, {searchExports: true});

        if (!this.userStore) throw new Error("Could not resolve Discord UserStore.");
        if (!this.dispatcher) throw new Error("Could not resolve Discord Flux dispatcher.");
    }

    patchUserStore() {
        if (!this.userStore?.getCurrentUser || !BdApi?.Patcher?.after) return;

        BdApi.Patcher.after(this.pluginName, this.userStore, "getCurrentUser", (_, __, user) => {
            this.forceDeveloperUser(user);
            return user;
        });
    }

    patchExperimentStores() {
        const nodes = this.getDispatcherNodes();

        for (const node of nodes) {
            if (!node || !["ExperimentStore", "DeveloperExperimentStore"].includes(node.name)) continue;

            if (node.storeDidChange && BdApi?.Patcher?.after) {
                BdApi.Patcher.after(this.pluginName, node, "storeDidChange", () => {
                    if (!this.isEnsuring) this.queueEnsureExperiments();
                });
            }

            const handler = node.actionHandler;
            if (!handler) continue;

            if (node.name === "ExperimentStore") this.patchBugReporterExperiment(node);

            for (const action of ["CONNECTION_OPEN"]) {
                if (typeof handler[action] !== "function" || !BdApi?.Patcher?.instead) continue;

                BdApi.Patcher.instead(this.pluginName, handler, action, (thisObject, args, original) => {
                    this.forceDeveloperPayload(args);
                    const result = original.apply(thisObject, args);
                    if (!this.isEnsuring) this.queueEnsureExperiments();
                    return result;
                });
            }
        }

        this.ensureTimer = window.setInterval(() => this.ensureExperiments("interval"), 10000);
    }

    patchBugReporterExperiment(experimentStore) {
        if (!experimentStore?.getUserExperimentBucket || !BdApi?.Patcher?.instead) return;

        BdApi.Patcher.instead(this.pluginName, experimentStore, "getUserExperimentBucket", (thisObject, args, original) => {
            if (args?.[0] === BUG_REPORTER_EXPERIMENT) return 1;
            return original.apply(thisObject, args);
        });
    }

    patchExperimentGuards() {
        this.patchServerAssignmentRuntime();
    }

    patchServerAssignmentRuntime() {
        this.patchLoadedServerAssignmentTargets();
        this.watchLazyServerAssignmentTargets();
    }

    patchLoadedServerAssignmentTargets() {
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllByPrototypeKeys) return;

        try {
            const targets = webpack.getAllByPrototypeKeys("getServerAssignment", {
                searchExports: true,
                defaultExport: false,
                fatal: false
            });

            for (const target of targets || []) {
                this.patchServerAssignmentTarget(target);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch loaded getServerAssignment targets.`, error);
        }
    }

    watchLazyServerAssignmentTargets() {
        const webpack = BdApi?.Webpack;
        if (!webpack?.waitForModule || this.lazyGuardAbortController) return;

        this.lazyGuardAbortController = new AbortController();

        try {
            webpack.waitForModule(target => this.isServerAssignmentTarget(target), {
                searchExports: true,
                defaultExport: false,
                fatal: false,
                signal: this.lazyGuardAbortController.signal
            }).then(target => this.patchServerAssignmentTarget(target)).catch(error => {
                if (error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for getServerAssignment target.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch getServerAssignment target.`, error);
        }
    }

    isServerAssignmentTarget(target) {
        return typeof target?.prototype?.getServerAssignment === "function"
            || typeof target?.getServerAssignment === "function";
    }

    patchServerAssignmentTarget(target) {
        const patchTarget = typeof target?.prototype?.getServerAssignment === "function" ? target.prototype : target;
        if (!patchTarget || typeof patchTarget.getServerAssignment !== "function") return;
        if (this.serverAssignmentTargets.has(patchTarget)) return;
        if (!BdApi?.Patcher?.instead) return;

        this.serverAssignmentTargets.add(patchTarget);

        BdApi.Patcher.instead(this.pluginName, patchTarget, "getServerAssignment", (thisObject, args, original) => {
            if (args?.[0] == null) return undefined;
            return original.apply(thisObject, args);
        });
    }

    startStaffHelpClickBlocker() {
        for (const eventName of this.staffHelpClickEvents) {
            document.addEventListener(eventName, this.staffHelpClickHandler, true);
        }
    }

    stopStaffHelpClickBlocker() {
        for (const eventName of this.staffHelpClickEvents) {
            document.removeEventListener(eventName, this.staffHelpClickHandler, true);
        }
    }

    handleStaffHelpInteraction(event) {
        if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
        if (!this.findStaffHelpTrigger(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    findStaffHelpTrigger(target) {
        if (!(target instanceof Element)) return null;

        const taggedNode = target.closest([
            `[id*='${STAFF_HELP_POPOUT}']`,
            `[aria-controls*='${STAFF_HELP_POPOUT}']`,
            `[aria-owns*='${STAFF_HELP_POPOUT}']`,
            `[data-popout-id*='${STAFF_HELP_POPOUT}']`,
            `[data-nav-id*='${STAFF_HELP_POPOUT}']`
        ].join(","));

        const interactive = (taggedNode || target).closest("button,[role='button'],[aria-haspopup]");
        if (!interactive) return null;

        for (const attribute of interactive.attributes) {
            if (String(attribute.value).includes(STAFF_HELP_POPOUT)) return interactive;
        }

        return taggedNode ? interactive : null;
    }

    ensureExperiments(reason) {
        if (this.isEnsuring) return;

        try {
            this.isEnsuring = true;
            const user = this.userStore?.getCurrentUser?.();
            this.forceDeveloperUser(user);

            const nodes = this.getDispatcherNodes();
            const experimentStore = nodes.find(node => node?.name === "ExperimentStore");
            const developerExperimentStore = nodes.find(node => node?.name === "DeveloperExperimentStore");
            const payload = {type: "user", user: this.createDeveloperUserPayload(user)};

            developerExperimentStore?.actionHandler?.CONNECTION_OPEN?.(payload);
            experimentStore?.storeDidChange?.();
            developerExperimentStore?.storeDidChange?.();
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to ensure experiments (${reason}).`, error);
        }
        finally {
            this.isEnsuring = false;
        }
    }

    queueEnsureExperiments() {
        if (this.isEnsuring) return;
        if (this.ensureQueued) return;

        this.ensureQueued = true;
        window.setTimeout(() => {
            this.ensureQueued = false;
            this.ensureExperiments("queued");
        }, 100);
    }

    forceDeveloperPayload(args) {
        if (!Array.isArray(args)) return;

        if (!args[0] || typeof args[0] !== "object") {
            args[0] = {type: "user", user: this.createDeveloperUserPayload()};
            return;
        }

        if (!args[0].user || typeof args[0].user !== "object") {
            args[0].user = this.createDeveloperUserPayload();
            return;
        }

        if (typeof args[0].user.flags === "number") args[0].user.flags |= DEV_FLAG;
        else args[0].user.flags = DEV_FLAG;
    }

    createDeveloperUserPayload(user = null) {
        const currentUser = user || this.userStore?.getCurrentUser?.();
        const flags = typeof currentUser?.flags === "number" ? currentUser.flags | DEV_FLAG : DEV_FLAG;

        return {
            ...currentUser,
            flags
        };
    }

    forceDeveloperUser(user) {
        if (!user || typeof user !== "object") return;

        if (!this.originalFlags.has(user)) {
            this.originalFlags.set(user, typeof user.flags === "number" ? user.flags : null);
        }

        if (typeof user.flags === "number") user.flags |= DEV_FLAG;
        else user.flags = DEV_FLAG;

        this.forceBooleanGetter(user, "isDeveloper");
    }

    forceBooleanGetter(instance, property) {
        const owner = Object.isExtensible(instance) ? instance : this.findPropertyOwner(instance, property);
        if (!owner) return;

        this.forceMember(owner, property, {
            configurable: true,
            get: () => true
        });
    }

    forceMember(target, property, descriptor) {
        if (!target || typeof target !== "object") return;
        if (this.forcedMembers.some(record => record.target === target && record.property === property)) return;

        const originalDescriptor = Object.getOwnPropertyDescriptor(target, property);
        if (originalDescriptor && !originalDescriptor.configurable) return;

        try {
            Object.defineProperty(target, property, descriptor);
            this.forcedMembers.push({
                target,
                property,
                hadOriginal: Boolean(originalDescriptor),
                originalDescriptor
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to force ${property}.`, error);
        }
    }

    findPropertyOwner(instance, property) {
        let target = instance;

        while (target && target !== Object.prototype) {
            if (Object.prototype.hasOwnProperty.call(target, property)) return target;
            target = Object.getPrototypeOf(target);
        }

        return null;
    }

    restoreForcedMembers() {
        for (const record of this.forcedMembers.splice(0).reverse()) {
            try {
                if (record.hadOriginal) {
                    Object.defineProperty(record.target, record.property, record.originalDescriptor);
                }
                else {
                    delete record.target[record.property];
                }
            }
            catch {}
        }
    }

    restoreUserFlags() {
        try {
            const user = this.userStore?.getCurrentUser?.();
            if (!user || !this.originalFlags.has(user)) return;

            const originalFlagValue = this.originalFlags.get(user);
            if (originalFlagValue === null) delete user.flags;
            else user.flags = originalFlagValue;
        }
        catch {}
    }

    flushExperimentStores() {
        try {
            const nodes = this.getDispatcherNodes();
            const experimentStore = nodes.find(node => node?.name === "ExperimentStore");
            const developerExperimentStore = nodes.find(node => node?.name === "DeveloperExperimentStore");
            const user = this.userStore?.getCurrentUser?.();
            const originalFlags = user && this.originalFlags.has(user) ? this.originalFlags.get(user) : 0;
            const payload = {type: "user", user: {...user, flags: originalFlags || 0}};

            developerExperimentStore?.actionHandler?.CONNECTION_OPEN?.(payload);
            experimentStore?.storeDidChange?.();
            developerExperimentStore?.storeDidChange?.();
        }
        catch {}
    }

    getDispatcherNodes() {
        const nodes = this.dispatcher?._actionHandlers?._dependencyGraph?.nodes;
        if (!nodes) return [];
        return Array.isArray(nodes) ? nodes : Object.values(nodes);
    }

    getStore(name) {
        try {
            if (BdApi?.Webpack?.getStore) return BdApi.Webpack.getStore(name);
        }
        catch {}

        return this.getDispatcherNodes().find(node => node?.name === name);
    }

    getWebpackModule(filter, options = {}) {
        try {
            if (BdApi?.Webpack?.getModule) return BdApi.Webpack.getModule(filter, options);
        }
        catch {}

        try {
            if (BdApi?.findModule) return BdApi.findModule(filter);
        }
        catch {}

        return null;
    }

    startDomObserver() {
        this.observer = new MutationObserver(() => this.queueEnsureWarningCard());
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    queueEnsureWarningCard() {
        window.requestAnimationFrame(() => this.ensureWarningCard());
    }

    ensureWarningCard() {
        const searchInput = Array.from(document.querySelectorAll("input")).find(input => {
            return input.placeholder === "Search experiments" || input.getAttribute("aria-label") === "Search experiments";
        });

        if (!searchInput) {
            this.removeWarningCard();
            return;
        }

        if (document.getElementById(this.warningId)) return;

        const container = this.findWarningContainer(searchInput);
        if (!container) return;

        const card = document.createElement("div");
        card.id = this.warningId;
        card.className = "bd-experiments-warning-card";
        card.innerHTML = `
            <div class="bd-experiments-warning-title">Hold on!!</div>
            <div>Experiments are unreleased Discord features. They might not work, can break your client, and can put your account at risk.</div>
            <div>Only use experiments if you know what they do. Server-side features cannot be enabled locally.</div>
        `;

        container.insertBefore(card, container.firstElementChild);
    }

    findWarningContainer(searchInput) {
        const candidates = [
            searchInput.closest("section"),
            searchInput.closest("[class*='content']"),
            searchInput.closest("[class*='scroller']"),
            searchInput.parentElement?.parentElement,
            searchInput.parentElement
        ];

        return candidates.find(candidate => candidate && candidate instanceof HTMLElement) || null;
    }

    removeWarningCard() {
        document.getElementById(this.warningId)?.remove();
    }

    injectStyles() {
        const css = `
            #staff-help-popout-staff-help-bug-reporter {
                display: none !important;
            }

            .bd-experiments-warning-card {
                background: var(--background-secondary);
                border: 1px solid var(--status-warning);
                border-radius: 8px;
                color: var(--text-normal);
                display: grid;
                gap: 8px;
                margin-bottom: 16px;
                padding: 12px 14px;
            }

            .bd-experiments-warning-title {
                color: var(--header-primary);
                font-size: 16px;
                font-weight: 700;
                line-height: 20px;
            }

        `;

        const bdDom = BdApi?.DOM;
        if (bdDom?.addStyle && bdDom?.removeStyle) {
            bdDom.removeStyle(this.styleId);
            bdDom.addStyle(this.styleId, css);
            return;
        }

        document.getElementById(this.styleId)?.remove();
        const style = document.createElement("style");
        style.id = this.styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    removeStyles() {
        const bdDom = BdApi?.DOM;
        if (bdDom?.removeStyle) {
            bdDom.removeStyle(this.styleId);
            return;
        }

        document.getElementById(this.styleId)?.remove();
    }

    showToast(message, type) {
        try {
            BdApi?.UI?.showToast?.(message, {type});
        }
        catch {}
    }

    reportError(message, error) {
        console.error(`[${this.pluginName}] ${message}`, error);

        try {
            BdApi?.UI?.showNotice?.(`${this.pluginName}: ${message} ${error?.message || error}`, {
                type: "error"
            });
        }
        catch {}
    }
};
