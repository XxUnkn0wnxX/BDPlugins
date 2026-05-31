/**
 * @name Experiments
 * @author openAI
 * @version 1.5.0
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

module.exports = class Experiments {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || PLUGIN_NAME;
        this.version = this.meta.version || "1.5.0";
        this.styleId = `${this.pluginName}-style`;
        this.warningId = `${this.pluginName}-warning-card`;
        this.serverAssignmentTargets = new WeakSet();
        this.bugReporterStores = new WeakSet();
        this.experimentUrlHelperModules = new WeakSet();
        this.playgroundEmbedModules = new WeakSet();
        this.playgroundLazyTypes = new WeakSet();
        this.staffWrappedComponentTypes = new WeakMap();
        this.devLinkRuleFactories = new WeakSet();
        this.devLinkRuleTargets = new WeakSet();
        this.lazyGuardAbortController = null;
        this.DevLinkErrorBoundary = null;
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
        this.patchBugReporterExperiment(this.getStore("ExperimentStore"));

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
        if (this.bugReporterStores.has(experimentStore)) return;

        this.bugReporterStores.add(experimentStore);

        BdApi.Patcher.instead(this.pluginName, experimentStore, "getUserExperimentBucket", (thisObject, args, original) => {
            if (!args?.length || typeof args[0] !== "string") return null;
            if (args?.[0] === BUG_REPORTER_EXPERIMENT) return 1;
            return original.apply(thisObject, args);
        });
    }

    patchExperimentGuards() {
        this.patchExperimentUrlHelpers();
        this.patchLoadedPlaygroundEmbedComponents();
        this.watchLazyPlaygroundEmbedComponents();
        this.patchExperimentDevLinkRuntimeGuards();
        this.patchServerAssignmentRuntime();
    }

    patchExperimentUrlHelpers() {
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(EXPERIMENT_URL_HELPER_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                this.patchExperimentUrlHelperModule(module?.exports);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch experiment URL helpers.`, error);
        }
    }

    patchExperimentUrlHelperModule(exports) {
        if (!exports || typeof exports !== "object") return;
        if (this.experimentUrlHelperModules.has(exports)) return;
        if (!BdApi?.Patcher?.instead) return;

        const hasHelperShape = typeof exports.W0 === "function"
            && typeof exports.OL === "function"
            && typeof exports.Kb === "function";
        if (!hasHelperShape) return;

        this.experimentUrlHelperModules.add(exports);

        BdApi.Patcher.instead(this.pluginName, exports, "W0", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
            if (originalResult) return originalResult;

            return this.getExperimentUrlMatch(args?.[0]) !== null;
        });

        BdApi.Patcher.instead(this.pluginName, exports, "OL", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
            if (originalResult != null) return originalResult;

            return this.getExperimentUrlId(args?.[0]);
        });

        BdApi.Patcher.instead(this.pluginName, exports, "Kb", (thisObject, args, original) => {
            const originalResult = original.apply(thisObject, args);
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

    patchExperimentDevLinkRuntimeGuards() {
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource || !BdApi?.Patcher?.after) return;

        try {
            const modules = webpack.getAllBySource(EXPERIMENT_EMBED_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                this.patchExperimentDevLinkRuleFactory(module?.exports);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch experiment dev-link guards.`, error);
        }
    }

    patchExperimentDevLinkRuleFactory(exports) {
        if (!exports || typeof exports.A !== "function") return;
        if (this.devLinkRuleFactories.has(exports)) return;

        this.devLinkRuleFactories.add(exports);

        BdApi.Patcher.after(this.pluginName, exports, "A", (_, __, rules) => {
            this.patchExperimentDevLinkRule(rules);
            return rules;
        });
    }

    patchExperimentDevLinkRule(rules) {
        const devLink = rules?.devLink;
        if (!devLink || typeof devLink.react !== "function") return;
        if (this.devLinkRuleTargets.has(devLink)) return;
        if (!BdApi?.Patcher?.instead) return;

        this.devLinkRuleTargets.add(devLink);

        BdApi.Patcher.instead(this.pluginName, devLink, "react", (thisObject, args, original) => {
            const url = this.getDevLinkUrl(args?.[0]);
            if (!this.isGuardedDevLink(url)) return original.apply(thisObject, args);
            if (this.isPlaygroundDevLink(url)) this.patchLoadedPlaygroundEmbedComponents();

            try {
                const element = original.apply(thisObject, args);
                if (this.isPlaygroundDevLink(url)) this.patchPlaygroundLazyTypes(element);
                return this.wrapDevLinkElement(element, url);
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

    wrapDevLinkElement(element, url) {
        const React = BdApi?.React;
        const Boundary = this.getDevLinkErrorBoundary();
        if (!React || !Boundary) return element;

        return React.createElement(Boundary, {
            fallback: this.createDevLinkFallback(url)
        }, this.wrapStaffGatedElement(element));
    }

    wrapStaffGatedElement(element) {
        const React = BdApi?.React;
        if (!React?.isValidElement?.(element)) return element;

        const children = element.props?.children;
        const wrappedChildren = Array.isArray(children)
            ? children.map(child => this.wrapStaffGatedElement(child))
            : this.wrapStaffGatedElement(children);
        const hasWrappedChildren = wrappedChildren !== children;
        const wrappedType = typeof element.type === "function" ? this.getStaffWrappedComponentType(element.type) : element.type;

        if (wrappedType === element.type && !hasWrappedChildren) return element;

        return React.createElement(wrappedType, {
            ...element.props,
            key: element.key,
            ref: element.ref
        }, wrappedChildren);
    }

    getStaffWrappedComponentType(type) {
        if (this.staffWrappedComponentTypes.has(type)) return this.staffWrappedComponentTypes.get(type);

        const plugin = this;
        const WrappedComponent = function ExperimentsStaffGatedEmbed(props) {
            return plugin.withTemporaryStaffUser(() => type(props));
        };

        WrappedComponent.displayName = `ExperimentsStaffGated(${type.displayName || type.name || "Component"})`;
        this.staffWrappedComponentTypes.set(type, WrappedComponent);
        return WrappedComponent;
    }

    withTemporaryStaffUser(callback) {
        const user = this.userStore?.getCurrentUser?.();
        const restore = [];

        this.forceTemporaryBooleanMethod(user, "isStaff", restore);
        this.forceTemporaryBooleanMethod(user, "isStaffPersonal", restore);

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

    patchLoadedPlaygroundEmbedComponents() {
        const webpack = BdApi?.Webpack;
        if (!webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(PLAYGROUND_EMBED_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                this.patchPlaygroundEmbedModule(module?.exports);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch loaded playground embed components.`, error);
        }
    }

    watchLazyPlaygroundEmbedComponents() {
        const webpack = BdApi?.Webpack;
        const bySource = webpack?.Filters?.bySource;
        if (!webpack?.waitForModule || !bySource) return;

        try {
            webpack.waitForModule(bySource(PLAYGROUND_EMBED_MARKER), {
                raw: true,
                fatal: false,
                signal: this.getLazyGuardSignal()
            }).then(module => this.patchPlaygroundEmbedModule(module?.exports)).catch(error => {
                if (error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for playground embed component.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch playground embed component.`, error);
        }
    }

    patchPlaygroundEmbedModule(exports) {
        if (!exports || typeof exports !== "object") return;
        if (this.playgroundEmbedModules.has(exports)) return;
        if (!BdApi?.Patcher?.instead) return;

        const targetKey = ["PlaygroundEmbed", "default"].find(key => {
            return typeof exports[key] === "function"
                && this.functionSource(exports[key]).includes(PLAYGROUND_EMBED_MARKER);
        });
        if (!targetKey) return;

        this.playgroundEmbedModules.add(exports);

        BdApi.Patcher.instead(this.pluginName, exports, targetKey, (thisObject, args, original) => {
            return this.withTemporaryStaffUser(() => original.apply(thisObject, args));
        });
    }

    patchPlaygroundLazyTypes(element) {
        if (!element || typeof element !== "object") return;

        const type = element.type;
        if (type && typeof type === "object") this.patchPlaygroundLazyType(type);

        const children = element.props?.children;
        if (Array.isArray(children)) {
            for (const child of children) this.patchPlaygroundLazyTypes(child);
        }
        else this.patchPlaygroundLazyTypes(children);
    }

    patchPlaygroundLazyType(lazyType) {
        const payload = lazyType?._payload;
        if (!payload || typeof payload._result !== "function") return;
        if (this.playgroundLazyTypes.has(lazyType)) return;
        if (!this.functionSource(payload._result).includes("PlaygroundEmbed")) return;

        this.playgroundLazyTypes.add(lazyType);

        const originalResult = payload._result;
        payload._result = (...args) => {
            const result = originalResult.apply(payload, args);
            if (!result?.then) return this.wrapResolvedPlaygroundModule(result);
            return result.then(module => this.wrapResolvedPlaygroundModule(module));
        };
    }

    wrapResolvedPlaygroundModule(module) {
        if (!module || typeof module !== "object") return module;
        if (typeof module.default !== "function") return module;
        return {
            ...module,
            default: this.getStaffWrappedComponentType(module.default)
        };
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

    patchServerAssignmentRuntime() {
        this.patchLoadedServerAssignmentTargets();
        this.watchLazyServerAssignmentTargets();
    }

    patchLoadedServerAssignmentTargets() {
        const webpack = BdApi?.Webpack;

        this.patchLoadedServerAssignmentModulesBySource(webpack);
        this.patchLoadedServerAssignmentTargetsByPrototype(webpack);
    }

    patchLoadedServerAssignmentModulesBySource(webpack) {
        if (!webpack?.getAllBySource) return;

        try {
            const modules = webpack.getAllBySource(SERVER_ASSIGNMENT_MARKER, {
                raw: true,
                fatal: false
            });

            for (const module of modules || []) {
                this.patchServerAssignmentRawModule(module);
            }
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to patch source-matched getServerAssignment modules.`, error);
        }
    }

    patchLoadedServerAssignmentTargetsByPrototype(webpack) {
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
        if (!webpack?.waitForModule) return;

        this.watchLazyServerAssignmentModulesBySource(webpack);
        this.watchLazyServerAssignmentTargetsByShape(webpack);
    }

    watchLazyServerAssignmentModulesBySource(webpack) {
        const bySource = webpack?.Filters?.bySource;
        if (!bySource) return;

        try {
            webpack.waitForModule(bySource(SERVER_ASSIGNMENT_MARKER), {
                raw: true,
                fatal: false,
                signal: this.getLazyGuardSignal()
            }).then(module => this.patchServerAssignmentRawModule(module)).catch(error => {
                if (error?.name !== "AbortError") {
                    console.error(`[${this.pluginName}] Failed while waiting for source-matched getServerAssignment module.`, error);
                }
            });
        }
        catch (error) {
            console.error(`[${this.pluginName}] Failed to watch source-matched getServerAssignment module.`, error);
        }
    }

    watchLazyServerAssignmentTargetsByShape(webpack) {
        try {
            webpack.waitForModule(target => this.isServerAssignmentTarget(target), {
                searchExports: true,
                defaultExport: false,
                fatal: false,
                signal: this.getLazyGuardSignal()
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

    patchServerAssignmentRawModule(module) {
        if (!module?.exports) return;

        for (const target of this.getServerAssignmentCandidates(module.exports)) {
            this.patchServerAssignmentTarget(target);
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

    getLazyGuardSignal() {
        if (!this.lazyGuardAbortController) this.lazyGuardAbortController = new AbortController();
        return this.lazyGuardAbortController.signal;
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
