"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Experiments = require("../Experiments.plugin.js");

function createHarness() {
    const intervals = new Map();
    const timeouts = new Map();
    const frames = new Map();
    const waits = [];
    const observers = [];
    const listeners = new Map();
    const saved = new Map();
    const sourceModules = new Map();
    const moduleFactories = new Map();
    const styleCalls = {add: 0, remove: 0};
    const patches = [];
    const calls = {connection: [], storeChanges: 0};
    let nextHandle = 1;

    const user = {
        id: "user",
        flags: 4,
        isStaff() {
            return false;
        },
        isStaffPersonal() {
            return false;
        }
    };
    const experimentStore = {
        name: "ExperimentStore",
        getUserExperimentBucket() {
            return 0;
        },
        storeDidChange() {
            calls.storeChanges++;
            return "experiment-changed";
        },
        actionHandler: {
            CONNECTION_OPEN(payload) {
                calls.connection.push({receiver: this, payload});
                return "experiment-open";
            }
        }
    };
    const developerExperimentStore = {
        name: "DeveloperExperimentStore",
        storeDidChange() {
            calls.storeChanges++;
            return "developer-changed";
        },
        actionHandler: {
            CONNECTION_OPEN(payload) {
                calls.connection.push({receiver: this, payload});
                return "developer-open";
            }
        }
    };
    const dispatcher = {
        _actionHandlers: {
            _dependencyGraph: {
                nodes: [experimentStore, developerExperimentStore]
            }
        }
    };
    const userStore = {
        _dispatcher: dispatcher,
        getCurrentUser() {
            return user;
        },
        getUsers() {
            return {user};
        }
    };

    const patcher = {
        after(plugin, target, method, callback) {
            const record = {plugin, target, method, next: target[method], wrapper: null};
            record.wrapper = function (...args) {
                const result = record.next.apply(this, args);
                const patchedResult = callback(this, args, result);
                return patchedResult === undefined ? result : patchedResult;
            };
            target[method] = record.wrapper;
            patches.push(record);
        },
        instead(plugin, target, method, callback) {
            const record = {plugin, target, method, next: target[method], wrapper: null};
            record.wrapper = function (...args) {
                const receiver = this;
                return callback(receiver, args, function (...originalArgs) {
                    return record.next.apply(this, originalArgs);
                });
            };
            target[method] = record.wrapper;
            patches.push(record);
        },
        unpatchAll(plugin) {
            for (let index = patches.length - 1; index >= 0; index--) {
                const record = patches[index];
                if (record.plugin !== plugin) continue;
                if (record.target[record.method] === record.wrapper) {
                    record.target[record.method] = record.next;
                }
                else {
                    const outerLayer = patches.find(candidate => candidate.next === record.wrapper);
                    if (outerLayer) outerLayer.next = record.next;
                }
                patches.splice(index, 1);
            }
        },
        activeCount() {
            return patches.length;
        }
    };

    global.window = {
        setInterval(callback) {
            const handle = nextHandle++;
            intervals.set(handle, callback);
            return handle;
        },
        clearInterval(handle) {
            intervals.delete(handle);
        },
        setTimeout(callback) {
            const handle = nextHandle++;
            timeouts.set(handle, callback);
            return handle;
        },
        clearTimeout(handle) {
            timeouts.delete(handle);
        },
        requestAnimationFrame(callback) {
            const handle = nextHandle++;
            frames.set(handle, callback);
            return handle;
        },
        cancelAnimationFrame(handle) {
            frames.delete(handle);
        },
        getComputedStyle() {
            return {overflowY: "visible"};
        }
    };
    global.document = {
        body: {},
        head: {appendChild() {}},
        addEventListener(name, handler) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(handler);
        },
        removeEventListener(name, handler) {
            listeners.get(name)?.delete(handler);
        },
        querySelectorAll() {
            return [];
        },
        getElementById() {
            return null;
        },
        createElement() {
            return {style: {}, classList: {add() {}, remove() {}}};
        }
    };
    global.Element = class Element {};
    global.HTMLElement = global.Element;
    global.MutationObserver = class MutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.disconnected = false;
            observers.push(this);
        }

        observe() {}

        disconnect() {
            this.disconnected = true;
        }
    };
    Object.defineProperty(global, "navigator", {
        configurable: true,
        value: {platform: "MacIntel"}
    });
    global.BdApi = {
        Data: {
            load(plugin, key) {
                return saved.get(`${plugin}:${key}`);
            },
            save(plugin, key, value) {
                saved.set(`${plugin}:${key}`, value);
            }
        },
        DOM: {
            addStyle() {
                styleCalls.add++;
            },
            removeStyle() {
                styleCalls.remove++;
            }
        },
        Patcher: patcher,
        UI: {
            showToast() {}
        },
        Webpack: {
            getStore(name) {
                return {UserStore: userStore, ExperimentStore: experimentStore}[name] || null;
            },
            getAllBySource(...searches) {
                if (searches.at(-1) && typeof searches.at(-1) === "object") searches.pop();
                return sourceModules.get(searches.join("\u0000")) || [];
            },
            Filters: {
                bySource(...markers) {
                    return (_, module) => {
                        const source = moduleFactories.get(module?.id);
                        return typeof source === "string" && markers.every(marker => source.includes(marker));
                    };
                }
            },
            waitForModule(filter, options) {
                return new Promise((resolve, reject) => waits.push({filter, options, resolve, reject}));
            }
        }
    };

    return {
        calls,
        developerExperimentStore,
        experimentStore,
        frames,
        intervals,
        listeners,
        observers,
        patcher,
        saved,
        moduleFactories,
        sourceModules,
        styleCalls,
        timeouts,
        user,
        userStore,
        waits
    };
}

function startPlugin() {
    const harness = createHarness();
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    plugin.start();
    return {harness, plugin};
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

const PLAYGROUND_COMPONENT_SOURCE = "function PlaygroundEmbed(){(0,configs.useComponentPlaygroundConfigs) ( ); PlaygroundStore.setState({});}";
const PLAYGROUND_REGISTRY_SOURCE = "function useComponentPlaygroundConfigs(){return []; }";
const DEV_LINK_RULE_FACTORY_SOURCE = "function createRules(){return {devLink:{match:(url,context)=>context.allowDevLinks ? null : null,parse:(url,context)=>({target:url,type : 'devLink'}),react(){}}};}";

function withFunctionSource(value, source) {
    Object.defineProperty(value, "toString", {
        configurable: true,
        value() {
            return source;
        }
    });
    return value;
}

function rawModule(harness, id, exports, source) {
    harness.moduleFactories.set(id, source);
    return {id, exports};
}

function findMatchingWait(waits, module) {
    return waits.find(wait => wait.filter(module.exports, module, module.id));
}

test("same instance can restart with fresh patches and restored state", () => {
    const {harness, plugin} = startPlugin();
    const firstPatchCount = harness.patcher.activeCount();

    assert.ok(firstPatchCount > 0);
    plugin.start();
    assert.equal(harness.patcher.activeCount(), firstPatchCount);
    assert.equal(harness.user.flags, 5);
    assert.equal(harness.user.isDeveloper, true);
    assert.equal(plugin.getLazyGuardSignal(), plugin.lazyGuardAbortController.signal);

    plugin.stop();

    const stoppedConnections = harness.calls.connection.length;
    plugin.stop();
    assert.equal(harness.calls.connection.length, stoppedConnections);
    assert.equal(harness.patcher.activeCount(), 0);
    assert.equal(harness.user.flags, 4);
    assert.equal(Object.hasOwn(harness.user, "isDeveloper"), false);
    assert.equal(plugin.getLazyGuardSignal(), null);
    assert.equal(plugin.ensureTimer, null);
    assert.equal(plugin.observer, null);
    assert.equal(plugin.forcedMembers.length, 0);
    assert.equal(plugin.originalFlags.size, 0);

    plugin.start();

    assert.equal(harness.patcher.activeCount(), firstPatchCount);
    assert.equal(harness.user.flags, 5);
    plugin.stop();
    assert.equal(harness.user.flags, 4);
});

test("resolved lazy waits from stopped runs cannot patch a successor", async () => {
    const {harness, plugin} = startPlugin();
    const component = withFunctionSource(function PlaygroundEmbed() {
        return "native";
    }, PLAYGROUND_COMPONENT_SOURCE);
    const staleModule = rawModule(harness, "stale-playground", {renamed: component}, PLAYGROUND_COMPONENT_SOURCE);
    const staleWait = findMatchingWait(harness.waits, staleModule);
    const serverTarget = {
        getServerAssignment() {
            return "native";
        }
    };
    const staleServerModule = rawModule(harness, "stale-server", serverTarget, "}getServerAssignment(");
    const staleServerSourceWait = findMatchingWait(harness.waits, staleServerModule);
    const staleServerTargetWait = harness.waits.find(wait => wait !== staleWait
        && wait !== staleServerSourceWait
        && wait.filter(serverTarget));
    assert.ok(staleWait);
    assert.ok(staleServerSourceWait);
    assert.ok(staleServerTargetWait);

    staleWait.resolve(staleModule);
    staleServerSourceWait.resolve(staleServerModule);
    plugin.stop();
    await settle();
    assert.equal(harness.patcher.activeCount(), 0);
    assert.equal(staleModule.exports.renamed, component);
    assert.equal(serverTarget.getServerAssignment(null), "native");

    plugin.start();
    const beforeResolution = harness.patcher.activeCount();

    staleServerTargetWait.resolve(serverTarget);
    await settle();

    assert.equal(harness.patcher.activeCount(), beforeResolution);
    assert.equal(staleModule.exports.renamed, component);
    assert.equal(serverTarget.getServerAssignment(null), "native");
    plugin.stop();
});

test("semantic export discovery patches renamed playground and dev-link exports after natural invocation", () => {
    const {harness, plugin} = startPlugin();
    const playgroundCalls = [];
    const playgroundReceiver = {name: "playground receiver"};
    const playgroundResult = {name: "playground result"};
    const PlaygroundEmbed = withFunctionSource(function PlaygroundEmbed(...args) {
        playgroundCalls.push({
            receiver: this,
            args,
            staff: harness.user.isStaff(),
            personal: harness.user.isStaffPersonal()
        });
        return playgroundResult;
    }, PLAYGROUND_COMPONENT_SOURCE);
    const playgroundExports = {
        arbitraryExport: PlaygroundEmbed,
        markerOnly: withFunctionSource(function markerOnly() {}, "function markerOnly(){useComponentPlaygroundConfigs;}")
    };
    Object.defineProperty(playgroundExports, "throwingGetter", {
        enumerable: true,
        get() {
            throw new Error("getter should not abort discovery");
        }
    });

    const beforePlaygroundPatch = harness.patcher.activeCount();
    plugin.patchPlaygroundEmbedModule(playgroundExports);
    assert.equal(harness.patcher.activeCount(), beforePlaygroundPatch + 1);
    assert.notEqual(playgroundExports.arbitraryExport, PlaygroundEmbed);
    assert.equal(playgroundExports.arbitraryExport.call(playgroundReceiver, "first", "second"), playgroundResult);
    assert.deepEqual(playgroundCalls, [{
        receiver: playgroundReceiver,
        args: ["first", "second"],
        staff: true,
        personal: true
    }]);
    assert.equal(harness.user.isStaff(), false);
    assert.equal(harness.user.isStaffPersonal(), false);

    const reactCalls = [];
    const rules = {
        devLink: {
            match() {
                return null;
            },
            parse() {
                return {type: "devLink"};
            },
            react(...args) {
                reactCalls.push({receiver: this, args});
                return this.result;
            }
        }
    };
    const factoryCalls = [];
    const factoryReceiver = {name: "factory receiver"};
    const RuleFactory = withFunctionSource(function RuleFactory(...args) {
        factoryCalls.push({receiver: this, args});
        return rules;
    }, DEV_LINK_RULE_FACTORY_SOURCE);
    const ruleExports = {Ay: RuleFactory};
    Object.defineProperty(ruleExports, "throwingGetter", {
        enumerable: true,
        get() {
            throw new Error("getter should not abort discovery");
        }
    });

    const beforeRuleFactoryPatch = harness.patcher.activeCount();
    plugin.patchExperimentDevLinkRuleFactory(ruleExports);
    assert.equal(factoryCalls.length, 0);
    assert.equal(harness.patcher.activeCount(), beforeRuleFactoryPatch + 1);
    assert.notEqual(ruleExports.Ay, RuleFactory);
    assert.equal(ruleExports.Ay.call(factoryReceiver, "factory arg"), rules);
    assert.deepEqual(factoryCalls, [{receiver: factoryReceiver, args: ["factory arg"]}]);

    const reactReceiver = {name: "react receiver", result: {name: "react result"}};
    const unguardedNode = {target: ["https://example.invalid"]};
    assert.equal(rules.devLink.react.call(reactReceiver, unguardedNode, "parse result", "key"), reactReceiver.result);
    assert.deepEqual(reactCalls, [{
        receiver: reactReceiver,
        args: [unguardedNode, "parse result", "key"]
    }]);

    const beforeInvalidRules = harness.patcher.activeCount();
    plugin.patchExperimentDevLinkRule(null);
    plugin.patchExperimentDevLinkRule({devLink: {match() {}, parse() {}, react: "not callable"}});
    plugin.patchExperimentDevLinkRule({devLink: {match() {}, react() {}}});
    assert.equal(harness.patcher.activeCount(), beforeInvalidRules);

    const secondPlayground = withFunctionSource(function secondPlayground() {}, PLAYGROUND_COMPONENT_SOURCE);
    const secondFactory = withFunctionSource(function secondFactory() {
        throw new Error("discovery must not execute this factory");
    }, DEV_LINK_RULE_FACTORY_SOURCE);
    const beforeAmbiguousCandidates = harness.patcher.activeCount();
    plugin.patchPlaygroundEmbedModule({first: PlaygroundEmbed, second: secondPlayground});
    plugin.patchExperimentDevLinkRuleFactory({Ay: RuleFactory, renamed: secondFactory});
    assert.equal(harness.patcher.activeCount(), beforeAmbiguousCandidates);
    plugin.stop();
});

test("loaded and late semantic module discovery rejects the playground registry and isolates stopped waiters", async () => {
    const harness = createHarness();
    const loadedComponent = withFunctionSource(function loadedComponent() {
        return "loaded";
    }, PLAYGROUND_COMPONENT_SOURCE);
    const loadedFactory = withFunctionSource(function loadedFactory() {
        return {devLink: {match() {}, parse() {}, react() {}}};
    }, DEV_LINK_RULE_FACTORY_SOURCE);
    const loadedPlayground = rawModule(harness, "loaded-playground", {renamed: loadedComponent}, PLAYGROUND_COMPONENT_SOURCE);
    const loadedRules = rawModule(harness, "loaded-rules", {Ay: loadedFactory}, "Clear Treatment " + DEV_LINK_RULE_FACTORY_SOURCE);
    harness.sourceModules.set("useComponentPlaygroundConfigs\u0000PlaygroundStore.setState", [loadedPlayground]);
    harness.sourceModules.set("Clear Treatment ", [loadedRules]);

    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    plugin.start();
    assert.notEqual(loadedPlayground.exports.renamed, loadedComponent);
    assert.notEqual(loadedRules.exports.Ay, loadedFactory);

    const latePlaygroundComponent = withFunctionSource(function latePlaygroundComponent() {
        return "late";
    }, PLAYGROUND_COMPONENT_SOURCE);
    const latePlayground = rawModule(harness, "late-playground", {anotherName: latePlaygroundComponent}, PLAYGROUND_COMPONENT_SOURCE);
    const registry = rawModule(harness, "playground-registry", {
        useComponentPlaygroundConfigs: withFunctionSource(function useComponentPlaygroundConfigs() {}, PLAYGROUND_REGISTRY_SOURCE)
    }, PLAYGROUND_REGISTRY_SOURCE);
    const lateRulesFactory = withFunctionSource(function lateRulesFactory() {
        return {devLink: {match() {}, parse() {}, react() {}}};
    }, DEV_LINK_RULE_FACTORY_SOURCE);
    const lateRules = rawModule(harness, "late-rules", {renamed: lateRulesFactory}, "Clear Treatment " + DEV_LINK_RULE_FACTORY_SOURCE);

    const playgroundWait = findMatchingWait(harness.waits, latePlayground);
    const ruleWait = findMatchingWait(harness.waits, lateRules);
    assert.ok(playgroundWait);
    assert.ok(ruleWait);
    assert.equal(playgroundWait.filter(registry.exports, registry, registry.id), false);
    assert.deepEqual(
        Object.fromEntries(["raw", "searchExports", "searchDefault", "fatal"].map(key => [key, playgroundWait.options[key]])),
        {raw: true, searchExports: false, searchDefault: false, fatal: false}
    );
    assert.deepEqual(
        Object.fromEntries(["raw", "searchExports", "searchDefault", "fatal"].map(key => [key, ruleWait.options[key]])),
        {raw: true, searchExports: false, searchDefault: false, fatal: false}
    );

    ruleWait.resolve(lateRules);
    await settle();
    assert.notEqual(lateRules.exports.renamed, lateRulesFactory);

    plugin.stop();
    assert.equal(lateRules.exports.renamed, lateRulesFactory);
    const firstRunWaits = new Set(harness.waits);
    plugin.start();
    const beforeStaleResolution = harness.patcher.activeCount();
    playgroundWait.resolve(latePlayground);
    await settle();
    assert.equal(harness.patcher.activeCount(), beforeStaleResolution);
    assert.equal(latePlayground.exports.anotherName, latePlaygroundComponent);

    const successorWait = findMatchingWait(harness.waits.filter(wait => !firstRunWaits.has(wait)), latePlayground);
    assert.ok(successorWait);
    successorWait.resolve(latePlayground);
    await settle();
    assert.notEqual(latePlayground.exports.anotherName, latePlaygroundComponent);
    plugin.stop();
});

test("stale timer, observer, and frame callbacks leave a restarted run untouched", () => {
    const {harness, plugin} = startPlugin();
    plugin.queueEnsureExperiments();

    const staleInterval = [...harness.intervals.values()][0];
    const staleTimeout = [...harness.timeouts.values()][0];
    const staleFrame = [...harness.frames.values()][0];
    const staleObserver = harness.observers[0];
    const callsBeforeStop = harness.calls.connection.length;

    plugin.stop();
    plugin.start();
    plugin.queueEnsureExperiments();
    assert.equal(plugin.ensureQueued, true);
    const successorTimer = plugin.ensureTimer;
    const successorTimeout = plugin.ensureTimeout;
    const successorObserver = plugin.observer;

    staleInterval();
    staleTimeout();
    staleFrame();
    staleObserver.callback();

    assert.equal(plugin.ensureQueued, true);
    assert.equal(plugin.ensureTimer, successorTimer);
    assert.equal(plugin.ensureTimeout, successorTimeout);
    assert.equal(plugin.observer, successorObserver);
    assert.equal(harness.calls.connection.length, callsBeforeStop + 2);
    plugin.stop();
});

test("lazy payload cleanup restores only plugin-owned loader and module values", async () => {
    const {plugin} = startPlugin();
    const rawModule = {default() { return "raw"; }};
    function PlaygroundEmbedLoader() {
        return rawModule;
    }
    const payload = {_status: -1, _result: PlaygroundEmbedLoader};

    plugin.patchPlaygroundLazyType({_payload: payload});
    const installedLoader = payload._result;
    plugin.stop();
    assert.equal(payload._result, PlaygroundEmbedLoader);

    plugin.start();
    payload._result = PlaygroundEmbedLoader;
    payload._status = -1;
    plugin.patchPlaygroundLazyType({_payload: payload});
    const wrappedModule = payload._result();
    payload._result = wrappedModule;
    plugin.stop();
    assert.equal(payload._result, rawModule);

    plugin.start();
    let resolvePending;
    function PlaygroundEmbedPendingLoader() {
        return new Promise(resolve => {
            resolvePending = resolve;
        });
    }
    const pendingPayload = {_status: -1, _result: PlaygroundEmbedPendingLoader};
    plugin.patchPlaygroundLazyType({_payload: pendingPayload});
    const wrappedPending = pendingPayload._result();
    const reactPending = new Promise(() => {});
    pendingPayload._result = reactPending;
    pendingPayload._status = 0;
    plugin.stop();
    assert.equal(pendingPayload._result, reactPending);
    resolvePending(rawModule);
    assert.equal(await wrappedPending, rawModule);

    plugin.start();
    const rejection = new Error("expected rejection");
    function PlaygroundEmbedRejectedLoader() {
        return Promise.reject(rejection);
    }
    const rejectedPayload = {_status: -1, _result: PlaygroundEmbedRejectedLoader};
    plugin.patchPlaygroundLazyType({_payload: rejectedPayload});
    const wrappedRejected = rejectedPayload._result();
    const reactRejection = Promise.reject(rejection);
    reactRejection.catch(() => {});
    rejectedPayload._result = reactRejection;
    rejectedPayload._status = 2;
    plugin.stop();
    assert.equal(rejectedPayload._result, reactRejection);
    await assert.rejects(wrappedRejected, rejection);

    assert.notEqual(installedLoader, PlaygroundEmbedLoader);
});

test("a recognized cached lazy payload is rewrapped on the next run without source matching its cached default", () => {
    const {harness, plugin} = startPlugin();
    function CachedComponent() {
        return harness.user.isStaff();
    }
    const rawModule = {default: CachedComponent};
    function PlaygroundEmbedLoader() {
        return rawModule;
    }
    const lazyType = {_payload: {_status: -1, _result: PlaygroundEmbedLoader}};

    assert.equal(plugin.functionSource(rawModule.default).includes("PlaygroundEmbed"), false);
    plugin.patchPlaygroundLazyType(lazyType);
    const firstRunModule = lazyType._payload._result();
    lazyType._payload._result = firstRunModule;
    lazyType._payload._status = 1;
    plugin.stop();
    assert.equal(lazyType._payload._result, rawModule);

    plugin.start();
    const pendingModule = {default: CachedComponent};
    lazyType._payload._status = 0;
    lazyType._payload._result = pendingModule;
    plugin.patchPlaygroundLazyType(lazyType);
    assert.equal(lazyType._payload._result, pendingModule);

    const rejectedModule = {default: CachedComponent};
    lazyType._payload._status = 2;
    lazyType._payload._result = rejectedModule;
    plugin.patchPlaygroundLazyType(lazyType);
    assert.equal(lazyType._payload._result, rejectedModule);

    const unknownModule = {default: CachedComponent};
    lazyType._payload._status = 99;
    lazyType._payload._result = unknownModule;
    plugin.patchPlaygroundLazyType(lazyType);
    assert.equal(lazyType._payload._result, unknownModule);

    const foreignModule = {default: CachedComponent};
    const racedModule = {};
    Object.defineProperty(racedModule, "default", {
        get() {
            lazyType._payload._result = foreignModule;
            return CachedComponent;
        }
    });
    lazyType._payload._status = 1;
    lazyType._payload._result = racedModule;
    plugin.patchPlaygroundLazyType(lazyType);
    assert.equal(lazyType._payload._result, foreignModule);

    lazyType._payload._status = 1;
    lazyType._payload._result = rawModule;
    plugin.patchPlaygroundLazyType(lazyType);
    assert.notEqual(lazyType._payload._result, rawModule);
    assert.equal(lazyType._payload._result.default(), true);
    plugin.stop();
    assert.equal(lazyType._payload._result, rawModule);
    assert.equal(rawModule.default(), false);
});

test("lazy aliases share one cleanup record and known payloads do not authorize replaced loaders", () => {
    const {plugin} = startPlugin();
    const rawModule = {default() { return "raw"; }};
    function PlaygroundEmbedLoader() {
        return rawModule;
    }
    const payload = {_status: -1, _result: PlaygroundEmbedLoader};
    const firstAlias = {_payload: payload};
    const secondAlias = {_payload: payload};

    plugin.patchPlaygroundLazyType(firstAlias);
    const installedLoader = payload._result;
    plugin.patchPlaygroundLazyType(secondAlias);
    assert.equal(payload._result, installedLoader);
    plugin.stop();
    assert.equal(payload._result, PlaygroundEmbedLoader);

    plugin.start();
    function UnrelatedLoader() {
        return rawModule;
    }
    payload._status = -1;
    payload._result = UnrelatedLoader;
    plugin.patchPlaygroundLazyType(firstAlias);
    assert.equal(payload._result, UnrelatedLoader);

    function PlaygroundEmbedRejectedLoader() {
        return rawModule;
    }
    payload._status = 2;
    payload._result = PlaygroundEmbedRejectedLoader;
    plugin.patchPlaygroundLazyType(firstAlias);
    assert.equal(payload._result, PlaygroundEmbedRejectedLoader);
    plugin.stop();
});

test("resolved lazy cleanup preserves a foreign null result", () => {
    const {plugin} = startPlugin();
    const rawModule = {default() { return "raw"; }};
    function PlaygroundEmbedLoader() {
        return rawModule;
    }
    const lazyType = {_payload: {_status: -1, _result: PlaygroundEmbedLoader}};

    plugin.patchPlaygroundLazyType(lazyType);
    lazyType._payload._result = lazyType._payload._result();
    lazyType._payload._status = 1;
    plugin.stop();
    assert.equal(lazyType._payload._result, rawModule);

    plugin.start();
    plugin.patchPlaygroundLazyType(lazyType);
    lazyType._payload._status = 2;
    lazyType._payload._result = null;
    plugin.stop();
    assert.equal(lazyType._payload._result, null);
});

test("old staff wrappers delegate natively and temporary staff methods always restore", () => {
    const {harness, plugin} = startPlugin();
    const receiver = {name: "receiver"};
    const calls = [];
    function Component(...args) {
        calls.push({receiver: this, args, staff: harness.user.isStaff(), personal: harness.user.isStaffPersonal()});
        return this;
    }

    const oldWrapper = plugin.getStaffWrappedComponentType(Component);
    assert.equal(oldWrapper.call(receiver, "active"), receiver);
    assert.deepEqual(calls.pop(), {receiver, args: ["active"], staff: true, personal: true});
    assert.equal(harness.user.isStaff(), false);

    assert.throws(() => plugin.withTemporaryStaffUser(() => {
        assert.equal(harness.user.isStaff(), true);
        throw new Error("render failed");
    }), /render failed/);
    assert.equal(harness.user.isStaff(), false);
    assert.equal(harness.user.isStaffPersonal(), false);

    plugin.stop();
    assert.equal(oldWrapper.call(receiver, "stopped"), receiver);
    assert.deepEqual(calls.pop(), {receiver, args: ["stopped"], staff: false, personal: false});

    plugin.start();
    assert.equal(oldWrapper.call(receiver, "successor"), receiver);
    assert.deepEqual(calls.pop(), {receiver, args: ["successor"], staff: false, personal: false});
    plugin.stop();
});

test("all forced users restore, payload copies stay unchanged, and each run tracks fresh values", () => {
    const {harness, plugin} = startPlugin();
    const numericUser = {flags: 12};
    const payloadUser = {};

    plugin.forceDeveloperUser(numericUser);
    plugin.forceDeveloperPayload([{user: payloadUser}]);
    assert.equal(numericUser.flags, 13);
    assert.equal(Object.hasOwn(payloadUser, "flags"), false);
    const trackedUsers = plugin.originalFlags.size;
    plugin.ensureExperiments("repeat");
    plugin.ensureExperiments("repeat");
    assert.equal(plugin.originalFlags.size, trackedUsers);

    plugin.stop();
    assert.equal(numericUser.flags, 12);
    assert.equal(Object.hasOwn(payloadUser, "flags"), false);

    numericUser.flags = 22;
    const absentUser = {};
    plugin.start();
    plugin.forceDeveloperUser(numericUser);
    plugin.forceDeveloperUser(absentUser);
    assert.equal(numericUser.flags, 23);
    assert.equal(absentUser.flags, 1);
    plugin.stop();
    assert.equal(numericUser.flags, 22);
    assert.equal(Object.hasOwn(absentUser, "flags"), false);
    assert.equal(harness.user.flags, 4);
});

test("source-matched helpers restore on stop and reapply on the same instance", () => {
    const harness = createHarness();
    const helpers = {
        W0() {
            return false;
        },
        OL() {
            return null;
        },
        Kb() {
            return NaN;
        },
        hp() {
            return [];
        }
    };
    harness.sourceModules.set('"^dev://experiment/', [{exports: helpers}]);
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});

    plugin.start();
    assert.equal(helpers.W0("dev://experiment/example"), true);
    assert.equal(helpers.OL("dev://experiment/example"), "example");
    plugin.stop();
    assert.equal(helpers.W0("dev://experiment/example"), false);
    assert.equal(helpers.OL("dev://experiment/example"), null);
    assert.equal(Number.isNaN(helpers.Kb("dev://experiment/example")), true);

    plugin.start();
    assert.equal(helpers.W0("dev://experiment/example"), true);
    assert.equal(helpers.OL("dev://experiment/example"), "example");
    plugin.stop();
});

test("disabled settings persist without mutating styles or document listeners", () => {
    const harness = createHarness();
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});

    plugin.updateSetting("toolbarDevMenu", true);

    assert.deepEqual(harness.saved.get("Experiments:settings"), {toolbarDevMenu: true});
    assert.equal(harness.styleCalls.add, 0);
    assert.equal(harness.styleCalls.remove, 0);
    assert.equal([...harness.listeners.values()].flatMap(set => [...set]).length, 0);
});

test("a later patch delegates through the lifecycle patch with the original receiver and arguments", () => {
    const {harness, plugin} = startPlugin();
    const externalReceiver = {name: "external"};
    let externalCalls = 0;
    BdApi.Patcher.instead("External", harness.developerExperimentStore.actionHandler, "CONNECTION_OPEN", (thisObject, args, original) => {
        externalCalls++;
        assert.equal(thisObject, externalReceiver);
        return `external:${original.apply(thisObject, args)}`;
    });
    const payload = {type: "user", user: {flags: 8}};

    assert.equal(harness.developerExperimentStore.actionHandler.CONNECTION_OPEN.call(externalReceiver, payload), "external:developer-open");
    assert.equal(externalCalls, 1);
    assert.equal(harness.calls.connection.at(-1).receiver, externalReceiver);
    assert.notEqual(harness.calls.connection.at(-1).payload, payload);
    assert.equal(harness.calls.connection.at(-1).payload.user.flags, 9);
    assert.equal(payload.user.flags, 8);
});
