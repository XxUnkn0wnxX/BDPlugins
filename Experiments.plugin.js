/**
 * @name Experiments
 * @author XxUnkn0wnxX (AI)
 * @authorId 361510310504562699
 * @version 1.6.2
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
const SERVER_ASSIGNMENT_MARKER = "}getServerAssignment(";
const EXPERIMENT_EMBED_MARKER = "Clear Treatment ";
const EXPERIMENT_URL_HELPER_MARKER = '"^dev://experiment/';
const EXPERIMENT_DEV_LINK_PREFIX = "dev://experiment/";
const PLAYGROUND_DEV_LINK_PREFIX = "dev://playground/";
const PLAYGROUND_EMBED_MARKER = "useComponentPlaygroundConfigs";
const EXPERIMENT_URL_FALLBACK = /^dev:\/\/experiment\/([^/\s]+)(?:\/([^/\s]+))?$/i;
const SETTING_TOOLBAR_DEV_MENU = "toolbarDevMenu";
const DEFAULT_SETTINGS = {
    [SETTING_TOOLBAR_DEV_MENU]: false
};

module.exports = class Experiments {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || PLUGIN_NAME;
        this.version = this.meta.version || "1.6.0";
        this.settings = {...DEFAULT_SETTINGS};
        this.styleId = `${this.pluginName}-style`;
        this.warningId = `${this.pluginName}-warning-card`;
        this.activeRun = null;
        this.stoppingRun = null;
        this.serverAssignmentTargets = null;
        this.bugReporterStores = null;
        this.experimentUrlHelperModules = null;
        this.playgroundEmbedModules = null;
        this.playgroundLazyTypes = null;
        // Recognition survives stop; patch ownership remains scoped to each run.
        this.knownPlaygroundLazyPayloads = new WeakSet();
        this.staffWrappedComponentTypes = null;
        this.devLinkRuleFactories = null;
        this.devLinkRuleTargets = null;
        this.lazyGuardAbortController = null;
        this.DevLinkErrorBoundary = null;
        this.originalFlags = null;
        this.forcedMembers = null;
        this.userStore = null;
        this.dispatcher = null;
        this.observer = null;
        this.ensureTimer = null;
        this.ensureTimeout = null;
        this.rafHandles = null;
        this.isRunning = false;
        this.ensureQueued = false;
        this.isEnsuring = false;
        this.staffHelpClickBlockerActive = false;
        this.staffHelpClickEvents = ["pointerdown", "mousedown", "click", "keydown"];
        this.staffHelpClickHandler = null;
    }

    start() {
        if (this.stoppingRun || this.isRunActive(this.activeRun)) return;

        const run = this.createRun();
        try {
            this.settings = this.loadSettings();
            this.showChangelogIfNeeded();
            this.injectStyles(run);
            this.resolveInternals(run);
            if (!this.isRunActive(run)) return;
            this.patchUserStore(run);
            this.patchExperimentStores(run);
            if (!this.isRunActive(run)) return;
            this.patchExperimentGuards(run);
            if (!this.isRunActive(run)) return;
            this.startStaffHelpClickBlocker(run);
            this.ensureExperiments("start", run);
            if (!this.isRunActive(run)) return;
            this.startDomObserver(run);
            this.queueEnsureWarningCard(run);
            if (this.isRunActive(run)) this.showToast("Experiments enabled.", "success");
        }
        catch (error) {
            this.reportError("Failed to start.", error);
            this.stop(run);
        }
    }

    createRun() {
        const run = {
            controller: new AbortController(),
            serverAssignmentTargets: new WeakSet(),
            bugReporterStores: new WeakSet(),
            experimentUrlHelperModules: new WeakSet(),
            playgroundEmbedModules: new WeakSet(),
            playgroundLazyTypes: new WeakSet(),
            staffWrappedComponentTypes: new WeakMap(),
            devLinkRuleFactories: new WeakSet(),
            devLinkRuleTargets: new WeakSet(),
            originalFlags: new Map(),
            forcedMembers: [],
            lazyPayloads: new Map(),
            rafHandles: new Set(),
            userStore: null,
            dispatcher: null,
            observer: null,
            ensureTimer: null,
            ensureTimeout: null,
            ensureQueued: false,
            isEnsuring: false,
            staffHelpClickBlockerActive: false,
            staffHelpClickHandler: null
        };

        this.activeRun = run;
        this.isRunning = true;
        this.serverAssignmentTargets = run.serverAssignmentTargets;
        this.bugReporterStores = run.bugReporterStores;
        this.experimentUrlHelperModules = run.experimentUrlHelperModules;
        this.playgroundEmbedModules = run.playgroundEmbedModules;
        this.playgroundLazyTypes = run.playgroundLazyTypes;
        this.staffWrappedComponentTypes = run.staffWrappedComponentTypes;
        this.devLinkRuleFactories = run.devLinkRuleFactories;
        this.devLinkRuleTargets = run.devLinkRuleTargets;
        this.lazyGuardAbortController = run.controller;
        this.originalFlags = run.originalFlags;
        this.forcedMembers = run.forcedMembers;
        this.userStore = null;
        this.dispatcher = null;
        this.observer = null;
        this.ensureTimer = null;
        this.ensureTimeout = null;
        this.rafHandles = run.rafHandles;
        this.ensureQueued = false;
        this.isEnsuring = false;
        this.staffHelpClickBlockerActive = false;
        this.staffHelpClickHandler = null;
        return run;
    }

    isRunActive(run) {
        return Boolean(run && this.activeRun === run && this.isRunning && !run.controller.signal.aborted);
    }

    stop(run = this.activeRun) {
        if (!run || this.stoppingRun || this.activeRun !== run) return;

        this.stoppingRun = run;
        try {
            this.activeRun = null;
            this.isRunning = false;
            run.controller.abort();

            if (this.lazyGuardAbortController === run.controller) this.lazyGuardAbortController = null;

            const observer = run.observer;
            if (observer) {
                observer.disconnect();
                run.observer = null;
            }
            if (this.observer === observer) this.observer = null;

            const ensureTimer = run.ensureTimer;
            if (ensureTimer != null) {
                window.clearInterval(ensureTimer);
                run.ensureTimer = null;
            }
            if (this.ensureTimer === ensureTimer) this.ensureTimer = null;

            const ensureTimeout = run.ensureTimeout;
            if (ensureTimeout != null) {
                window.clearTimeout(ensureTimeout);
                run.ensureTimeout = null;
            }
            if (this.ensureTimeout === ensureTimeout) this.ensureTimeout = null;

            for (const frame of run.rafHandles) window.cancelAnimationFrame(frame);
            run.rafHandles.clear();

            this.stopStaffHelpClickBlocker(run);

            try {
                BdApi?.Patcher?.unpatchAll?.(this.pluginName);
            }
            catch {}

            this.restoreLazyPayloads(run);
            this.restoreForcedMembers(run);
            this.restoreUserFlags(run);
            this.flushExperimentStores(run, true);
            run.originalFlags.clear();
            this.removeWarningCard();
            this.removeStyles();
            run.ensureQueued = false;
            run.isEnsuring = false;

            if (!this.activeRun) {
                this.userStore = null;
                this.dispatcher = null;
                this.observer = null;
                this.ensureTimer = null;
                this.ensureTimeout = null;
                this.rafHandles = null;
                this.ensureQueued = false;
                this.isEnsuring = false;
                this.staffHelpClickBlockerActive = false;
                this.staffHelpClickHandler = null;
            }

            this.showToast("Experiments disabled.", "info");
        }
        finally {
            if (this.stoppingRun === run) this.stoppingRun = null;
        }
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
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Patched the public ExperimentStore object as well as the dispatcher node so the toolbar developer menu bucket is forced on current Discord builds."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added BetterDiscord-owned experiment URL helper patches for negative treatment IDs and treatment-label links."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added scoped staff-gate wrappers for experiment and playground dev-link embeds without globally forcing Discord staff methods."
                    ]
                },
                {
                    title: "Added",
                    type: "added",
                    items: [
                        "Added BetterDiscord-native settings for Equicord's toolbar developer menu toggle and DevTools shortcut information."
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
                        "Patched source-identified getServerAssignment store exports in addition to prototype targets."
                    ]
                },
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Wrapped experiment dev-link embed rendering in a local error boundary fallback to prevent malformed links from crashing Discord."
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

    getSettingsPanel() {
        this.settings = this.loadSettings();

        return BdApi.UI.buildSettingsPanel({
            settings: [
                {
                    type: "switch",
                    id: SETTING_TOOLBAR_DEV_MENU,
                    name: "Toolbar developer menu",
                    note: "Show Discord's developer toolbar/menu controls near the Help (?) button.",
                    value: this.settings[SETTING_TOOLBAR_DEV_MENU]
                },
                {
                    type: "keybind",
                    id: "devtoolsShortcut",
                    name: "DevTools shortcut",
                    note: `Open Discord's DevTools with ${this.getDevToolsShortcut()}. This shortcut is provided by Discord and cannot be changed here.`,
                    value: this.getDevToolsShortcutKeys(),
                    disabled: true,
                    clearable: false,
                    max: 3
                }
            ],
            onChange: (_, id, value) => this.updateSetting(id, value)
        });
    }

    getDevToolsShortcut() {
        const platform = navigator?.platform || "";
        return /Mac|iPhone|iPad|iPod/i.test(platform) ? "cmd + opt + O" : "ctrl + alt + O";
    }

    getDevToolsShortcutKeys() {
        const platform = navigator?.platform || "";
        return /Mac|iPhone|iPad|iPod/i.test(platform) ? ["cmd", "opt", "O"] : ["Control", "Alt", "O"];
    }

    loadSettings() {
        try {
            const saved = BdApi?.Data?.load?.(this.pluginName, "settings");
            return {
                ...DEFAULT_SETTINGS,
                ...(saved && typeof saved === "object" ? saved : {})
            };
        }
        catch {
            return {...DEFAULT_SETTINGS};
        }
    }

    saveSettings() {
        try {
            BdApi?.Data?.save?.(this.pluginName, "settings", this.settings);
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to save settings.`, error);
        }
    }

    updateSetting(id, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, id)) return;

        this.settings = {
            ...this.settings,
            [id]: Boolean(value)
        };
        this.saveSettings();

        const run = this.activeRun;
        if (id !== SETTING_TOOLBAR_DEV_MENU || !this.isRunActive(run)) return;

        this.injectStyles(run);
        if (!this.isRunActive(run)) return;
        if (this.settings[SETTING_TOOLBAR_DEV_MENU]) this.startStaffHelpClickBlocker(run);
        else this.stopStaffHelpClickBlocker(run);
        if (!this.isRunActive(run)) return;
        this.flushExperimentStores(run);
        if (!this.isRunActive(run)) return;
        this.ensureExperiments("settings", run);
        this.showToast("Toolbar developer menu setting saved. Reload Discord if the toolbar does not update immediately.", "info");
    }

    resolveInternals(run = this.activeRun) {
        if (!this.isRunActive(run)) return;

        const userStore = this.getStore("UserStore", run) || this.getWebpackModule(module => {
            return module?.getCurrentUser && module?.getUsers;
        }, {searchExports: true});

        if (!this.isRunActive(run)) return;

        const dispatcher = userStore?._dispatcher || this.getWebpackModule(module => {
            return module?.dispatch && module?.subscribe && module?.unsubscribe;
        }, {searchExports: true});

        if (!userStore) throw new Error("Could not resolve Discord UserStore.");
        if (!dispatcher) throw new Error("Could not resolve Discord Flux dispatcher.");
        if (!this.isRunActive(run)) return;

        run.userStore = userStore;
        run.dispatcher = dispatcher;
        this.userStore = userStore;
        this.dispatcher = dispatcher;
    }

    patchUserStore(run = this.activeRun) {
        if (!this.isRunActive(run) || !run.userStore?.getCurrentUser || !BdApi?.Patcher?.after) return;

        BdApi.Patcher.after(this.pluginName, run.userStore, "getCurrentUser", (_, __, user) => {
            if (!this.isRunActive(run)) return user;
            this.forceDeveloperUser(user, run);
            return user;
        });
    }

    patchExperimentStores(run = this.activeRun) {
        if (!this.isRunActive(run)) return;

        const nodes = this.getDispatcherNodes(run);
        this.patchBugReporterExperiment(this.getStore("ExperimentStore", run), run);

        for (const node of nodes) {
            if (!this.isRunActive(run)) return;
            if (!node || !["ExperimentStore", "DeveloperExperimentStore"].includes(node.name)) continue;

            if (node.storeDidChange && BdApi?.Patcher?.after) {
                BdApi.Patcher.after(this.pluginName, node, "storeDidChange", () => {
                    if (!this.isRunActive(run) || run.isEnsuring) return;
                    this.queueEnsureExperiments(run);
                });
            }

            const handler = node.actionHandler;
            if (!handler) continue;

            if (node.name === "ExperimentStore") this.patchBugReporterExperiment(node, run);

            for (const action of ["CONNECTION_OPEN"]) {
                if (typeof handler[action] !== "function" || !BdApi?.Patcher?.instead) continue;

                BdApi.Patcher.instead(this.pluginName, handler, action, (thisObject, args, original) => {
                    if (!this.isRunActive(run)) return original.apply(thisObject, args);
                    this.forceDeveloperPayload(args, run);
                    const result = original.apply(thisObject, args);
                    if (this.isRunActive(run) && !run.isEnsuring) this.queueEnsureExperiments(run);
                    return result;
                });
            }
        }

        if (!this.isRunActive(run)) return;
        const timer = window.setInterval(() => {
            if (!this.isRunActive(run)) return;
            this.ensureExperiments("interval", run);
        }, 10000);
        run.ensureTimer = timer;
        if (this.isRunActive(run)) this.ensureTimer = timer;
        else window.clearInterval(timer);
    }

    patchBugReporterExperiment(experimentStore, run = this.activeRun) {
        if (!this.isRunActive(run) || !experimentStore?.getUserExperimentBucket || !BdApi?.Patcher?.instead) return;
        if (run.bugReporterStores.has(experimentStore)) return;

        run.bugReporterStores.add(experimentStore);

        BdApi.Patcher.instead(this.pluginName, experimentStore, "getUserExperimentBucket", (thisObject, args, original) => {
            if (!this.isRunActive(run)) return original.apply(thisObject, args);
            if (!args?.length || typeof args[0] !== "string") return original.apply(thisObject, args);
            if (args?.[0] === BUG_REPORTER_EXPERIMENT && this.settings[SETTING_TOOLBAR_DEV_MENU]) return 1;
            return original.apply(thisObject, args);
        });
    }

    patchExperimentGuards(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        this.patchExperimentUrlHelpers(run);
        this.patchLoadedPlaygroundEmbedComponents(run);
        this.watchLazyPlaygroundEmbedComponents(run);
        this.patchExperimentDevLinkRuntimeGuards(run);
        this.patchServerAssignmentRuntime(run);
    }

    patchExperimentUrlHelpers(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(EXPERIMENT_URL_HELPER_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                if (!this.isRunActive(run)) return;
                this.patchExperimentUrlHelperModule(module?.exports, run);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch experiment URL helpers.`, error);
        }
    }

    patchExperimentUrlHelperModule(exports, run = this.activeRun) {
        if (!this.isRunActive(run) || !exports || typeof exports !== "object") return;
        if (run.experimentUrlHelperModules.has(exports)) return;
        if (!BdApi?.Patcher?.instead) return;

        const hasHelperShape = typeof exports.W0 === "function"
            && typeof exports.OL === "function"
            && typeof exports.Kb === "function";
        if (!hasHelperShape) return;

        run.experimentUrlHelperModules.add(exports);

        BdApi.Patcher.instead(this.pluginName, exports, "W0", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
            if (!this.isRunActive(run)) return originalResult;
            if (originalResult) return originalResult;

            return this.getExperimentUrlMatch(args?.[0]) !== null;
        });

        BdApi.Patcher.instead(this.pluginName, exports, "OL", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
            if (!this.isRunActive(run)) return originalResult;
            if (originalResult != null) return originalResult;

            return this.getExperimentUrlId(args?.[0]);
        });

        BdApi.Patcher.instead(this.pluginName, exports, "Kb", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
            if (!this.isRunActive(run)) return originalResult;
            if (Number.isFinite(originalResult)) return originalResult;

            const treatment = this.getExperimentUrlTreatment(args?.[0]);
            if (treatment == null) return null;

            if (/^-?\d+$/.test(treatment)) return Number(treatment);

            const experimentId = this.getExperimentUrlId(args?.[0]);
            const matchedTreatment = this.findExperimentTreatmentByLabel(exports, experimentId, treatment);
            return matchedTreatment ?? null;
        });
    }

    getExperimentUrlMatch(url) {
        if (typeof url !== "string") return null;
        return EXPERIMENT_URL_FALLBACK.exec(url);
    }

    getExperimentUrlId(url) {
        return this.getExperimentUrlMatch(url)?.[1] ?? null;
    }

    getExperimentUrlTreatment(url) {
        const treatment = this.getExperimentUrlMatch(url)?.[2];
        if (treatment == null) return null;
        return this.safeDecodeURIComponent(treatment);
    }

    safeDecodeURIComponent(value) {
        try {
            return decodeURIComponent(String(value));
        }
        catch {
            return String(value);
        }
    }

    findExperimentTreatmentByLabel(helpers, experimentId, treatment) {
        if (!experimentId || typeof helpers?.hp !== "function") return null;

        let options = [];
        try {
            options = helpers.hp(experimentId) || [];
        }
        catch {
            return null;
        }

        const target = this.cleanExperimentLabel(treatment);
        if (!target) return null;

        const match = options.find(option => {
            return this.cleanExperimentLabel(option?.label) === target
                || this.cleanExperimentLabel(option?.value) === target
                || this.cleanExperimentLabel(option?.id) === target;
        });

        return match ? match.value ?? match.id ?? null : null;
    }

    cleanExperimentLabel(value) {
        return String(value ?? "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
    }

    functionSource(value) {
        try {
            return Function.prototype.toString.call(value);
        }
        catch {
            return "";
        }
    }

    patchExperimentDevLinkRuntimeGuards(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource || !BdApi?.Patcher?.after) return;

        try {
            const modules = webpack.getAllBySource(EXPERIMENT_EMBED_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                if (!this.isRunActive(run)) return;
                this.patchExperimentDevLinkRuleFactory(module?.exports, run);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch experiment dev-link guards.`, error);
        }
    }

    patchExperimentDevLinkRuleFactory(exports, run = this.activeRun) {
        if (!this.isRunActive(run) || !exports || typeof exports.A !== "function") return;
        if (run.devLinkRuleFactories.has(exports)) return;

        run.devLinkRuleFactories.add(exports);

        BdApi.Patcher.after(this.pluginName, exports, "A", (_, __, rules) => {
            if (!this.isRunActive(run)) return rules;
            this.patchExperimentDevLinkRule(rules, run);
            return rules;
        });
    }

    patchExperimentDevLinkRule(rules, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const devLink = rules?.devLink;
        if (!devLink || typeof devLink.react !== "function") return;
        if (run.devLinkRuleTargets.has(devLink)) return;
        if (!BdApi?.Patcher?.instead) return;

        run.devLinkRuleTargets.add(devLink);

        BdApi.Patcher.instead(this.pluginName, devLink, "react", (thisObject, args, original) => {
            if (!this.isRunActive(run)) return original.apply(thisObject, args);
            const url = this.getDevLinkUrl(args?.[0]);
            if (!this.isGuardedDevLink(url)) return original.apply(thisObject, args);
            if (this.isPlaygroundDevLink(url)) this.patchLoadedPlaygroundEmbedComponents(run);
            if (!this.isRunActive(run)) return original.apply(thisObject, args);

            try {
                const element = original.apply(thisObject, args);
                if (!this.isRunActive(run)) return element;
                if (this.isPlaygroundDevLink(url)) this.patchPlaygroundLazyTypes(element, run);
                return this.wrapDevLinkElement(element, url, run);
            }
            catch (error) {
                console.error(`[${this.pluginName}] Blocked experiment dev-link render crash.`, error);
                return this.createDevLinkFallback(url);
            }
        });
    }

    getDevLinkUrl(node) {
        return Array.isArray(node?.target) ? String(node.target[0] || "") : "";
    }

    isExperimentDevLink(url) {
        return url.startsWith(EXPERIMENT_DEV_LINK_PREFIX);
    }

    isPlaygroundDevLink(url) {
        return url.startsWith(PLAYGROUND_DEV_LINK_PREFIX);
    }

    isGuardedDevLink(url) {
        return this.isExperimentDevLink(url) || this.isPlaygroundDevLink(url);
    }

    wrapDevLinkElement(element, url, run = this.activeRun) {
        if (!this.isRunActive(run)) return element;
        const React = BdApi?.React;
        const Boundary = this.getDevLinkErrorBoundary();
        if (!React || !Boundary) return element;

        return React.createElement(Boundary, {
            fallback: this.createDevLinkFallback(url)
        }, this.wrapStaffGatedElement(element, run));
    }

    wrapStaffGatedElement(element, run = this.activeRun) {
        if (!this.isRunActive(run)) return element;
        const React = BdApi?.React;
        if (!React?.isValidElement?.(element)) return element;

        const children = element.props?.children;
        const wrappedChildren = Array.isArray(children)
            ? children.map(child => this.wrapStaffGatedElement(child, run))
            : this.wrapStaffGatedElement(children, run);
        const hasWrappedChildren = wrappedChildren !== children;
        const wrappedType = typeof element.type === "function" ? this.getStaffWrappedComponentType(element.type, run) : element.type;

        if (wrappedType === element.type && !hasWrappedChildren) return element;

        return React.createElement(wrappedType, {
            ...element.props,
            key: element.key,
            ref: element.ref
        }, wrappedChildren);
    }

    getStaffWrappedComponentType(type, run = this.activeRun) {
        if (!this.isRunActive(run)) return type;
        if (run.staffWrappedComponentTypes.has(type)) return run.staffWrappedComponentTypes.get(type);

        const plugin = this;
        const WrappedComponent = function ExperimentsStaffGatedEmbed(...args) {
            if (!plugin.isRunActive(run)) return type.apply(this, args);
            return plugin.withTemporaryStaffUser(() => type.apply(this, args), run);
        };

        WrappedComponent.displayName = `ExperimentsStaffGated(${type.displayName || type.name || "Component"})`;
        run.staffWrappedComponentTypes.set(type, WrappedComponent);
        return WrappedComponent;
    }

    withTemporaryStaffUser(callback, run = this.activeRun) {
        if (!this.isRunActive(run)) return callback();

        const user = run.userStore?.getCurrentUser?.();
        if (!this.isRunActive(run)) return callback();
        const restore = [];

        this.forceTemporaryBooleanMethod(user, "isStaff", restore);
        if (this.isRunActive(run)) this.forceTemporaryBooleanMethod(user, "isStaffPersonal", restore);

        try {
            return callback();
        }
        finally {
            for (const restoreMethod of restore.reverse()) restoreMethod();
        }
    }

    forceTemporaryBooleanMethod(target, property, restore) {
        if (!target || typeof target !== "object") return;

        try {
            if (typeof target[property] === "function" && target[property]() === true) return;
        }
        catch {}

        const descriptor = Object.getOwnPropertyDescriptor(target, property);
        if (descriptor && !descriptor.configurable) return;

        try {
            Object.defineProperty(target, property, {
                configurable: true,
                value: () => true
            });

            restore.push(() => {
                try {
                    if (descriptor) Object.defineProperty(target, property, descriptor);
                    else delete target[property];
                }
                catch {}
            });
        }
        catch {}
    }

    patchLoadedPlaygroundEmbedComponents(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(PLAYGROUND_EMBED_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                if (!this.isRunActive(run)) return;
                this.patchPlaygroundEmbedModule(module?.exports, run);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch loaded playground embed components.`, error);
        }
    }

    watchLazyPlaygroundEmbedComponents(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;
        const bySource = webpack?.Filters?.bySource;
        if (!webpack?.waitForModule || !bySource) return;

        const signal = this.getLazyGuardSignal(run);
        if (!signal) return;

        try {
            webpack.waitForModule(bySource(PLAYGROUND_EMBED_MARKER), {
                raw: true,
                fatal: false,
                signal
            }).then(module => {
                if (!this.isRunActive(run)) return;
                this.patchPlaygroundEmbedModule(module?.exports, run);
            }).catch(error => {
                if (this.isRunActive(run) && error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for playground embed component.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch playground embed component.`, error);
        }
    }

    patchPlaygroundEmbedModule(exports, run = this.activeRun) {
        if (!this.isRunActive(run) || !exports || typeof exports !== "object") return;
        if (run.playgroundEmbedModules.has(exports)) return;
        if (!BdApi?.Patcher?.instead) return;

        const targetKey = ["PlaygroundEmbed", "default"].find(key => {
            return typeof exports[key] === "function"
                && this.functionSource(exports[key]).includes(PLAYGROUND_EMBED_MARKER);
        });
        if (!targetKey) return;

        run.playgroundEmbedModules.add(exports);

        BdApi.Patcher.instead(this.pluginName, exports, targetKey, (thisObject, args, original) => {
            if (!this.isRunActive(run)) return original.apply(thisObject, args);
            return this.withTemporaryStaffUser(() => original.apply(thisObject, args), run);
        });
    }

    patchPlaygroundLazyTypes(element, run = this.activeRun) {
        if (!this.isRunActive(run) || !element || typeof element !== "object") return;

        const type = element.type;
        if (type && typeof type === "object") this.patchPlaygroundLazyType(type, run);

        const children = element.props?.children;
        if (Array.isArray(children)) {
            for (const child of children) this.patchPlaygroundLazyTypes(child, run);
        }
        else this.patchPlaygroundLazyTypes(children, run);
    }

    patchPlaygroundLazyType(lazyType, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const payload = lazyType?._payload;
        if (!payload) return;
        if (run.playgroundLazyTypes.has(lazyType) || run.lazyPayloads.has(payload)) return;

        const currentResult = payload._result;
        if (typeof currentResult !== "function") {
            if (!this.knownPlaygroundLazyPayloads.has(payload)
                || payload._status !== 1
                || !currentResult
                || typeof currentResult !== "object"
                || typeof currentResult.default !== "function") return;

            const record = {
                payload,
                originalResult: currentResult,
                installedResult: null,
                resolvedModules: new Map()
            };
            const wrappedModule = this.wrapResolvedPlaygroundModule(currentResult, run, record);
            if (wrappedModule === currentResult) return;
            if (!this.isRunActive(run) || payload._status !== 1 || payload._result !== currentResult) return;

            run.playgroundLazyTypes.add(lazyType);
            run.lazyPayloads.set(payload, record);
            payload._result = wrappedModule;
            return;
        }

        if (payload._status !== -1 || !this.functionSource(currentResult).includes("PlaygroundEmbed")) return;

        const originalResult = currentResult;
        const record = {
            payload,
            originalResult,
            installedResult: null,
            resolvedModules: new Map()
        };
        const plugin = this;
        const installedResult = function ExperimentsPlaygroundLazyLoader(...args) {
            const result = originalResult.apply(payload, args);
            if (!plugin.isRunActive(run)) return result;
            if (!result?.then) return plugin.wrapResolvedPlaygroundModule(result, run, record);
            return result.then(module => {
                if (!plugin.isRunActive(run)) return module;
                return plugin.wrapResolvedPlaygroundModule(module, run, record);
            });
        };
        record.installedResult = installedResult;
        if (!this.isRunActive(run) || payload._status !== -1 || payload._result !== currentResult) return;

        run.playgroundLazyTypes.add(lazyType);
        this.knownPlaygroundLazyPayloads.add(payload);
        run.lazyPayloads.set(payload, record);
        payload._result = installedResult;
    }

    wrapResolvedPlaygroundModule(module, run = this.activeRun, record = null) {
        if (!this.isRunActive(run) || !module || typeof module !== "object") return module;
        if (typeof module.default !== "function") return module;
        const wrappedModule = {
            ...module,
            default: this.getStaffWrappedComponentType(module.default, run)
        };
        if (record) record.resolvedModules.set(wrappedModule, module);
        return wrappedModule;
    }

    restoreLazyPayloads(run) {
        for (const record of run.lazyPayloads.values()) {
            try {
                if (typeof record.installedResult === "function" && record.payload._result === record.installedResult) {
                    record.payload._result = record.originalResult;
                    continue;
                }

                for (const [wrappedModule, originalModule] of record.resolvedModules) {
                    if (record.payload._result === wrappedModule) {
                        record.payload._result = originalModule;
                        break;
                    }
                }
            }
            catch {}
        }
        run.lazyPayloads.clear();
    }

    createDevLinkFallback(url) {
        const React = BdApi?.React;
        if (!React) return null;

        return React.createElement("span", null, url);
    }

    getDevLinkErrorBoundary() {
        if (this.DevLinkErrorBoundary) return this.DevLinkErrorBoundary;

        const React = BdApi?.React;
        if (!React?.Component) return null;

        const pluginName = this.pluginName;
        this.DevLinkErrorBoundary = class DevLinkErrorBoundary extends React.Component {
            constructor(props) {
                super(props);
                this.state = {hasError: false};
            }

            static getDerivedStateFromError() {
                return {hasError: true};
            }

            componentDidCatch(error) {
                console.error(`[${pluginName}] Blocked experiment dev-link child render crash.`, error);
            }

            render() {
                return this.state.hasError ? this.props.fallback : this.props.children;
            }
        };

        return this.DevLinkErrorBoundary;
    }

    patchServerAssignmentRuntime(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        this.patchLoadedServerAssignmentTargets(run);
        this.watchLazyServerAssignmentTargets(run);
    }

    patchLoadedServerAssignmentTargets(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;

        this.patchLoadedServerAssignmentModulesBySource(webpack, run);
        this.patchLoadedServerAssignmentTargetsByPrototype(webpack, run);
    }

    patchLoadedServerAssignmentModulesBySource(webpack, run = this.activeRun) {
        if (!this.isRunActive(run) || !webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(SERVER_ASSIGNMENT_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                if (!this.isRunActive(run)) return;
                this.patchServerAssignmentRawModule(module, run);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch source-matched getServerAssignment modules.`, error);
        }
    }

    patchLoadedServerAssignmentTargetsByPrototype(webpack, run = this.activeRun) {
        if (!this.isRunActive(run) || !webpack?.getAllByPrototypeKeys) return;

        try {
            const targets = webpack.getAllByPrototypeKeys("getServerAssignment", {
                searchExports: true,
                defaultExport: false,
                fatal: false
            });

            for (const target of targets || []) {
                if (!this.isRunActive(run)) return;
                this.patchServerAssignmentTarget(target, run);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch loaded getServerAssignment targets.`, error);
        }
    }

    watchLazyServerAssignmentTargets(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const webpack = BdApi?.Webpack;
        if (!webpack?.waitForModule) return;

        this.watchLazyServerAssignmentModulesBySource(webpack, run);
        this.watchLazyServerAssignmentTargetsByShape(webpack, run);
    }

    watchLazyServerAssignmentModulesBySource(webpack, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const bySource = webpack?.Filters?.bySource;
        if (!bySource) return;

        const signal = this.getLazyGuardSignal(run);
        if (!signal) return;

        try {
            webpack.waitForModule(bySource(SERVER_ASSIGNMENT_MARKER), {
                raw: true,
                fatal: false,
                signal
            }).then(module => {
                if (!this.isRunActive(run)) return;
                this.patchServerAssignmentRawModule(module, run);
            }).catch(error => {
                if (this.isRunActive(run) && error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for source-matched getServerAssignment module.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch source-matched getServerAssignment module.`, error);
        }
    }

    watchLazyServerAssignmentTargetsByShape(webpack, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const signal = this.getLazyGuardSignal(run);
        if (!signal) return;

        try {
            webpack.waitForModule(target => this.isServerAssignmentTarget(target), {
                searchExports: true,
                defaultExport: false,
                fatal: false,
                signal
            }).then(target => {
                if (!this.isRunActive(run)) return;
                this.patchServerAssignmentTarget(target, run);
            }).catch(error => {
                if (this.isRunActive(run) && error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for getServerAssignment target.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch getServerAssignment target.`, error);
        }
    }

    patchServerAssignmentRawModule(module, run = this.activeRun) {
        if (!this.isRunActive(run) || !module?.exports) return;

        for (const target of this.getServerAssignmentCandidates(module.exports)) {
            if (!this.isRunActive(run)) return;
            this.patchServerAssignmentTarget(target, run);
        }
    }

    getServerAssignmentCandidates(exports) {
        const candidates = new Set();
        const add = value => {
            if (!value || (typeof value !== "object" && typeof value !== "function")) return;
            candidates.add(value);
            if (value.prototype) candidates.add(value.prototype);
        };

        add(exports);
        add(exports.default);

        if (typeof exports === "object") {
            for (const value of Object.values(exports)) add(value);
        }

        return candidates;
    }

    isServerAssignmentTarget(target) {
        return typeof target?.prototype?.getServerAssignment === "function"
            || typeof target?.getServerAssignment === "function";
    }

    patchServerAssignmentTarget(target, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const patchTarget = typeof target?.prototype?.getServerAssignment === "function" ? target.prototype : target;
        if (!patchTarget || typeof patchTarget.getServerAssignment !== "function") return;
        if (run.serverAssignmentTargets.has(patchTarget)) return;
        if (!BdApi?.Patcher?.instead) return;

        run.serverAssignmentTargets.add(patchTarget);

        BdApi.Patcher.instead(this.pluginName, patchTarget, "getServerAssignment", (thisObject, args, original) => {
            if (!this.isRunActive(run)) return original.apply(thisObject, args);
            if (args?.[0] == null) return undefined;
            return original.apply(thisObject, args);
        });
    }

    getLazyGuardSignal(run = this.activeRun) {
        return this.isRunActive(run) ? run.controller.signal : null;
    }

    startStaffHelpClickBlocker(run = this.activeRun) {
        if (!this.isRunActive(run) || !this.settings[SETTING_TOOLBAR_DEV_MENU] || run.staffHelpClickBlockerActive) return;

        const handler = event => this.handleStaffHelpInteraction(event, run);

        for (const eventName of this.staffHelpClickEvents) {
            document.addEventListener(eventName, handler, true);
        }

        if (!this.isRunActive(run)) {
            for (const eventName of this.staffHelpClickEvents) {
                document.removeEventListener(eventName, handler, true);
            }
            return;
        }

        run.staffHelpClickHandler = handler;
        run.staffHelpClickBlockerActive = true;
        this.staffHelpClickHandler = handler;
        this.staffHelpClickBlockerActive = true;
    }

    stopStaffHelpClickBlocker(run = this.activeRun) {
        if (!run?.staffHelpClickBlockerActive) return;

        for (const eventName of this.staffHelpClickEvents) {
            document.removeEventListener(eventName, run.staffHelpClickHandler, true);
        }

        if (this.staffHelpClickHandler === run.staffHelpClickHandler) {
            this.staffHelpClickHandler = null;
            this.staffHelpClickBlockerActive = false;
        }
        run.staffHelpClickHandler = null;
        run.staffHelpClickBlockerActive = false;
    }

    handleStaffHelpInteraction(event, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        if (!this.settings[SETTING_TOOLBAR_DEV_MENU]) return;
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

    ensureExperiments(reason, run = this.activeRun) {
        if (!this.isRunActive(run) || run.isEnsuring) return;

        try {
            run.isEnsuring = true;
            this.isEnsuring = true;
            const user = run.userStore?.getCurrentUser?.();
            if (!this.isRunActive(run)) return;
            this.forceDeveloperUser(user, run);
            if (!this.isRunActive(run)) return;

            const nodes = this.getDispatcherNodes(run);
            const experimentStore = nodes.find(node => node?.name === "ExperimentStore");
            const developerExperimentStore = nodes.find(node => node?.name === "DeveloperExperimentStore");
            const payload = {type: "user", user: this.createDeveloperUserPayload(user)};

            developerExperimentStore?.actionHandler?.CONNECTION_OPEN?.(payload);
            if (!this.isRunActive(run)) return;
            experimentStore?.storeDidChange?.();
            if (!this.isRunActive(run)) return;
            developerExperimentStore?.storeDidChange?.();
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to ensure experiments (${reason}).`, error);
        }
        finally {
            if (this.isRunActive(run)) {
                run.isEnsuring = false;
                this.isEnsuring = false;
            }
        }
    }

    queueEnsureExperiments(run = this.activeRun) {
        if (!this.isRunActive(run) || run.isEnsuring || run.ensureQueued) return;

        run.ensureQueued = true;
        this.ensureQueued = true;
        const timeout = window.setTimeout(() => {
            if (run.ensureTimeout === timeout) {
                run.ensureTimeout = null;
                if (this.activeRun === run && this.ensureTimeout === timeout) this.ensureTimeout = null;
            }
            if (!this.isRunActive(run)) return;
            run.ensureQueued = false;
            this.ensureQueued = false;
            this.ensureExperiments("queued", run);
        }, 100);
        run.ensureTimeout = timeout;
        if (this.isRunActive(run)) this.ensureTimeout = timeout;
        else window.clearTimeout(timeout);
    }

    forceDeveloperPayload(args, run = this.activeRun) {
        if (!this.isRunActive(run) || !Array.isArray(args)) return;

        if (!args[0] || typeof args[0] !== "object") {
            const user = this.createDeveloperUserPayload();
            if (!this.isRunActive(run)) return;
            args[0] = {type: "user", user};
            return;
        }

        const payload = {...args[0]};
        if (!payload.user || typeof payload.user !== "object") {
            const user = this.createDeveloperUserPayload();
            if (!this.isRunActive(run)) return;
            payload.user = user;
            args[0] = payload;
            return;
        }

        payload.user = {
            ...payload.user,
            flags: typeof payload.user.flags === "number" ? payload.user.flags | DEV_FLAG : DEV_FLAG
        };
        args[0] = payload;
    }

    createDeveloperUserPayload(user = null, run = this.activeRun) {
        const currentUser = user || (this.isRunActive(run) ? run.userStore?.getCurrentUser?.() : null);
        const flags = typeof currentUser?.flags === "number" ? currentUser.flags | DEV_FLAG : DEV_FLAG;

        return {
            ...currentUser,
            flags
        };
    }

    trackOriginalFlags(user, run = this.activeRun) {
        if (!this.isRunActive(run) || !user || typeof user !== "object" || run.originalFlags.has(user)) return;
        run.originalFlags.set(user, typeof user.flags === "number" ? user.flags : null);
    }

    forceDeveloperUser(user, run = this.activeRun) {
        if (!this.isRunActive(run) || !user || typeof user !== "object") return;

        this.trackOriginalFlags(user, run);

        if (typeof user.flags === "number") user.flags |= DEV_FLAG;
        else user.flags = DEV_FLAG;

        this.forceBooleanGetter(user, "isDeveloper", run);
    }

    forceBooleanGetter(instance, property, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const owner = Object.isExtensible(instance) ? instance : this.findPropertyOwner(instance, property);
        if (!owner) return;

        this.forceMember(owner, property, {
            configurable: true,
            get: () => true
        }, run);
    }

    forceMember(target, property, descriptor, run = this.activeRun) {
        if (!this.isRunActive(run) || !target || typeof target !== "object") return;
        if (run.forcedMembers.some(record => record.target === target && record.property === property)) return;

        const originalDescriptor = Object.getOwnPropertyDescriptor(target, property);
        if (originalDescriptor && !originalDescriptor.configurable) return;

        try {
            Object.defineProperty(target, property, descriptor);
            run.forcedMembers.push({
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

    restoreForcedMembers(run) {
        for (const record of run.forcedMembers.splice(0).reverse()) {
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

    restoreUserFlags(run) {
        for (const [user, originalFlagValue] of run.originalFlags) {
            try {
                if (originalFlagValue === null) delete user.flags;
                else user.flags = originalFlagValue;
            }
            catch {}
        }
    }

    flushExperimentStores(run = this.activeRun, allowStopped = false) {
        if (!allowStopped && !this.isRunActive(run)) return;
        try {
            const nodes = this.getDispatcherNodes(run);
            const experimentStore = nodes.find(node => node?.name === "ExperimentStore");
            const developerExperimentStore = nodes.find(node => node?.name === "DeveloperExperimentStore");
            const user = run.userStore?.getCurrentUser?.();
            const originalFlags = user && run.originalFlags.has(user) ? run.originalFlags.get(user) : 0;
            const payload = {type: "user", user: {...user, flags: originalFlags || 0}};

            developerExperimentStore?.actionHandler?.CONNECTION_OPEN?.(payload);
            experimentStore?.storeDidChange?.();
            developerExperimentStore?.storeDidChange?.();
        }
        catch {}
    }

    getDispatcherNodes(run = this.activeRun) {
        const nodes = run?.dispatcher?._actionHandlers?._dependencyGraph?.nodes;
        if (!nodes) return [];
        return Array.isArray(nodes) ? nodes : Object.values(nodes);
    }

    getStore(name, run = this.activeRun) {
        try {
            if (BdApi?.Webpack?.getStore) return BdApi.Webpack.getStore(name);
        }
        catch {}

        return this.getDispatcherNodes(run).find(node => node?.name === name);
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

    startDomObserver(run = this.activeRun) {
        if (!this.isRunActive(run)) return;

        const observer = new MutationObserver(() => {
            if (!this.isRunActive(run)) return;
            this.queueEnsureWarningCard(run);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        if (!this.isRunActive(run)) {
            observer.disconnect();
            return;
        }

        run.observer = observer;
        this.observer = observer;
    }

    scheduleFrame(callback, run = this.activeRun) {
        if (!this.isRunActive(run)) return null;

        let frame = null;
        frame = window.requestAnimationFrame(() => {
            run.rafHandles.delete(frame);
            if (!this.isRunActive(run)) return;
            callback();
        });
        run.rafHandles.add(frame);
        return frame;
    }

    queueEnsureWarningCard(run = this.activeRun) {
        this.scheduleFrame(() => this.ensureWarningCard(run), run);
    }

    ensureWarningCard(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const searchInput = Array.from(document.querySelectorAll("input")).find(input => {
            return input.placeholder === "Search experiments" || input.getAttribute("aria-label") === "Search experiments";
        });

        if (!searchInput) {
            this.removeWarningCard();
            return;
        }

        const existingCard = document.getElementById(this.warningId);
        if (existingCard) {
            this.updateWarningCardScrollSpacing(existingCard, run);
            return;
        }

        const container = this.findWarningContainer(searchInput);
        if (!container) return;

        const card = document.createElement("div");
        card.id = this.warningId;
        card.className = "bd-experiments-warning-card";
        card.innerHTML = `
            <div class="bd-experiments-warning-title">Hold on!!</div>
            <div>Experiments are unreleased Discord features. They might not work, or even break your client or get your account disabled.</div>
            <div>Only use experiments if you know what you're doing. Equicord is not responsible for any damage caused by enabling experiments.</div>
            <div>If you don't know what an experiment does, ignore it. Do not ask us what experiments do either, we probably don't know.</div>
            <div>No, you cannot use server-side features like checking the "Send to Client" box.</div>
        `;

        container.insertBefore(card, container.firstElementChild);
        this.updateWarningCardScrollSpacing(card, run);
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
        for (const host of document.querySelectorAll(".bd-experiments-warning-scroll-host")) {
            host.classList.remove("bd-experiments-warning-scroll-host");
            host.style.removeProperty("--bd-experiments-warning-scroll-offset");
        }
    }

    updateWarningCardScrollSpacing(card, run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const host = this.findScrollableAncestor(card);
        if (!host) return;

        this.scheduleFrame(() => {
            const height = Math.ceil(card.getBoundingClientRect().height || 0);
            if (!height) return;

            for (const previousHost of document.querySelectorAll(".bd-experiments-warning-scroll-host")) {
                if (previousHost === host) continue;
                previousHost.classList.remove("bd-experiments-warning-scroll-host");
                previousHost.style.removeProperty("--bd-experiments-warning-scroll-offset");
            }

            host.classList.add("bd-experiments-warning-scroll-host");
            host.style.setProperty("--bd-experiments-warning-scroll-offset", `${height + 16}px`);
        }, run);
    }

    findScrollableAncestor(node) {
        let current = node?.parentElement;

        while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            const canScroll = /(auto|scroll)/.test(style.overflowY) || current.scrollHeight > current.clientHeight;
            if (canScroll) return current;
            current = current.parentElement;
        }

        return null;
    }

    injectStyles(run = this.activeRun) {
        if (!this.isRunActive(run)) return;
        const css = `
            #staff-help-popout-staff-help-bug-reporter {
                ${this.settings[SETTING_TOOLBAR_DEV_MENU] ? "display: none !important;" : ""}
            }

            ${this.settings[SETTING_TOOLBAR_DEV_MENU] ? "" : `
            [aria-label="DevTools"][role="button"],
            [aria-label="DevTools"].clickable__81391 {
                display: none !important;
            }
            `}

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

            .bd-experiments-warning-scroll-host {
                box-sizing: border-box;
                padding-bottom: var(--bd-experiments-warning-scroll-offset, 0px) !important;
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
