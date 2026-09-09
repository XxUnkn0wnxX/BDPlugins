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
const PLAYGROUND_LOADER_SOURCE = "()=>Promise.all([n.e(\"503634\"),n.e(\"761764\"),n.e(\"218126\"),n.e(\"467696\")]).then(n.bind(n,881267)).then(e=>({default:e.PlaygroundEmbed}))";
const PLAYGROUND_LOADER_CANONICAL_SOURCE = "()=>Promise.all([n.e(\"503634\"),n.e(\"761764\"),n.e(\"218126\"),n.e(\"467696\")]).then(n.bind(n,881267))";

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

function installReactHarness(loadEntry = async () => null) {
    const lazyFactories = [];
    const React = {
        Component: class Component {},
        createElement(type, config, ...children) {
            const props = {...config};
            const key = config?.key ?? null;
            const ref = config?.ref ?? null;
            delete props.key;
            if (children.length === 1) props.children = children[0];
            else if (children.length > 1) props.children = children;
            return {$$typeof: Symbol.for("react.element"), type, key, ref, props};
        },
        cloneElement(element, config, ...children) {
            const props = {...element.props, ...config};
            const key = config?.key ?? element.key;
            // React 19 cloneElement carries ref through props without reading element.ref.
            const ref = props.ref ?? null;
            delete props.key;
            if (children.length === 1) props.children = children[0];
            else if (children.length > 1) props.children = children;
            return {$$typeof: Symbol.for("react.element"), type: element.type, key, ref, props};
        },
        isValidElement(value) {
            return value?.$$typeof === Symbol.for("react.element");
        },
        lazy(factory) {
            const lazyType = {$$typeof: Symbol.for("react.lazy"), _factory: factory};
            lazyFactories.push(lazyType);
            return lazyType;
        }
    };

    global.BdApi.React = React;
    global.BdApi.Utils = {loadEntry};
    return {React, lazyFactories};
}

function playgroundLazy(loader, status = -1, result = loader) {
    return {
        $$typeof: Symbol.for("react.lazy"),
        _payload: {_status: status, _result: result}
    };
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

test("playground entry source parsing accepts native aliases and rejects unsafe loader shapes", () => {
    const {plugin} = startPlugin();
    const loader = withFunctionSource(function nativeLoader() {}, PLAYGROUND_LOADER_SOURCE);
    assert.equal(plugin.getPlaygroundEntryLoaderSource(loader), PLAYGROUND_LOADER_CANONICAL_SOURCE);

    const aliasedSource = "() => Promise . all ( [ $webpack . e ( \"503634\" ) , $webpack . e ( \"761764\" ) ] ) . then ( $webpack . bind ( $webpack , 881267 ) ) . then ( $row$ => ( { default : $row$ . $playground } ) )";
    assert.equal(
        plugin.getPlaygroundEntryLoaderSource(withFunctionSource(function aliasedLoader() {}, aliasedSource)),
        "()=>Promise.all([n.e(\"503634\"),n.e(\"761764\")]).then(n.bind(n,881267))"
    );

    const invalidSources = [
        PLAYGROUND_LOADER_SOURCE.replace('n.e("761764")', 'other.e("761764")'),
        PLAYGROUND_LOADER_SOURCE.replace('.then(e=>({default:e.PlaygroundEmbed}))', '.then(e=>({default:e.PlaygroundEmbed})).then(n.bind(n,1))'),
        PLAYGROUND_LOADER_SOURCE.replace('n.e("503634")', 'n.e(chunkId)'),
        PLAYGROUND_LOADER_SOURCE.replace('"503634"', '"503 634"'),
        PLAYGROUND_LOADER_SOURCE.replace('"503634"', '"50\\u0033"'),
        PLAYGROUND_LOADER_SOURCE.replace('"503634"', "'503634'"),
        `(${PLAYGROUND_LOADER_SOURCE});extra`
    ];
    for (const source of invalidSources) {
        assert.equal(plugin.getPlaygroundEntryLoaderSource(withFunctionSource(function invalidLoader() {}, source)), null, source);
    }
    plugin.stop();
});

test("playground lazy loading uses one public request and preserves native state", async () => {
    const {harness, plugin} = startPlugin();
    const loadCalls = [];
    let nativeLoaderCalls = 0;
    const componentCalls = [];
    const receiver = {name: "component receiver"};
    const result = {name: "component result"};
    const component = withFunctionSource(function PlaygroundEmbed(...args) {
        componentCalls.push({receiver: this, args, staff: harness.user.isStaff(), personal: harness.user.isStaffPersonal()});
        if (args[0] === "throw") throw new Error("render failed");
        return result;
    }, PLAYGROUND_COMPONENT_SOURCE);
    const frozenExports = Object.freeze({renamedExport: component});
    const loader = withFunctionSource(function nativeLoader() {
        nativeLoaderCalls++;
        return Promise.reject(new Error("native loader must stay untouched"));
    }, PLAYGROUND_LOADER_SOURCE);
    const payload = Object.freeze({_status: -1, _result: loader});
    const lazyType = {$$typeof: Symbol.for("react.lazy"), _payload: payload};
    const {lazyFactories} = installReactHarness(function loadEntry(source) {
        loadCalls.push({receiver: this, source});
        return Promise.resolve([frozenExports]);
    });

    const replacement = plugin.getPlaygroundLazyComponentType(lazyType);
    assert.notEqual(replacement, lazyType);
    assert.equal(plugin.getPlaygroundLazyComponentType(lazyType), replacement);
    assert.equal(lazyFactories.length, 1);
    assert.equal(loadCalls.length, 0);
    assert.equal(nativeLoaderCalls, 0);
    assert.equal(payload._result, loader);

    const [firstModule, secondModule] = await Promise.all([replacement._factory(), replacement._factory()]);
    assert.equal(loadCalls.length, 1);
    assert.equal(loadCalls[0].receiver, BdApi.Utils);
    assert.equal(loadCalls[0].source, PLAYGROUND_LOADER_CANONICAL_SOURCE);
    assert.equal(firstModule.default, secondModule.default);
    assert.equal(firstModule.default.call(receiver, "first"), result);
    assert.deepEqual(componentCalls.at(-1), {receiver, args: ["first"], staff: true, personal: true});
    assert.equal(harness.user.isStaff(), false);
    assert.equal(harness.user.isStaffPersonal(), false);
    assert.throws(() => firstModule.default.call(receiver, "throw"), /render failed/);
    assert.equal(harness.user.isStaff(), false);
    assert.equal(harness.user.isStaffPersonal(), false);

    plugin.stop();
    assert.equal(firstModule.default.call(receiver, "after-stop"), result);
    assert.deepEqual(componentCalls.at(-1), {receiver, args: ["after-stop"], staff: false, personal: false});
    assert.equal(harness.user.isStaff(), false);
});

test("resolved semantic lazy payloads wrap directly while foreign states stay untouched", () => {
    const {harness, plugin} = startPlugin();
    const component = withFunctionSource(function PlaygroundEmbed(...args) {
        return {receiver: this, args, staff: harness.user.isStaff()};
    }, PLAYGROUND_COMPONENT_SOURCE);
    const resolvedModule = Object.freeze({default: component});
    const resolvedPayload = Object.freeze({_status: 1, _result: resolvedModule});
    const resolvedLazy = {$$typeof: Symbol.for("react.lazy"), _payload: resolvedPayload};

    const wrapped = plugin.getPlaygroundLazyComponentType(resolvedLazy);
    assert.notEqual(wrapped, resolvedLazy);
    assert.equal(wrapped.call(harness.user, "resolved").staff, true);
    assert.equal(harness.user.isStaff(), false);
    assert.equal(resolvedPayload._result, resolvedModule);

    const unchanged = [
        playgroundLazy(null, 0, {default: component}),
        playgroundLazy(null, 2, {default: component}),
        playgroundLazy(null, 99, {default: component}),
        playgroundLazy(null, 1, {default() { return "foreign"; }}),
        playgroundLazy(null, 1, {default: "not callable"}),
        playgroundLazy(null, 1, (() => {
            const value = {};
            Object.defineProperty(value, "default", {get() { throw new Error("foreign getter"); }});
            return value;
        })())
    ];
    for (const lazyType of unchanged) assert.equal(plugin.getPlaygroundLazyComponentType(lazyType), lazyType);

    const foreignModule = {default: function foreign() {}};
    const racedPayload = {_status: 1, _result: {}};
    Object.defineProperty(racedPayload._result, "default", {
        get() {
            racedPayload._result = foreignModule;
            return component;
        }
    });
    const racedLazy = {$$typeof: Symbol.for("react.lazy"), _payload: racedPayload};
    assert.equal(plugin.getPlaygroundLazyComponentType(racedLazy), racedLazy);
    assert.equal(racedPayload._result, foreignModule);
    plugin.stop();
});

test("lazy replacement cache revalidates payload and loader identity", () => {
    const {plugin} = startPlugin();
    installReactHarness();
    const loaderOne = withFunctionSource(function loaderOne() {}, PLAYGROUND_LOADER_SOURCE);
    const loaderTwo = withFunctionSource(function loaderTwo() {}, PLAYGROUND_LOADER_SOURCE);
    const payload = {_status: -1, _result: loaderOne};
    const lazyType = {$$typeof: Symbol.for("react.lazy"), _payload: payload};

    const first = plugin.getPlaygroundLazyComponentType(lazyType);
    assert.equal(plugin.getPlaygroundLazyComponentType(lazyType), first);

    const foreignLoader = withFunctionSource(function foreignLoader() {}, "() => Promise.resolve(null)");
    payload._result = foreignLoader;
    assert.equal(plugin.getPlaygroundLazyComponentType(lazyType), lazyType);

    payload._result = loaderTwo;
    const second = plugin.getPlaygroundLazyComponentType(lazyType);
    assert.notEqual(second, first);
    assert.equal(plugin.getPlaygroundLazyComponentType(lazyType), second);

    const racedPayload = {_status: -1};
    const racedLazy = {$$typeof: Symbol.for("react.lazy"), _payload: racedPayload};
    const racedLoader = withFunctionSource(function racedLoader() {}, PLAYGROUND_LOADER_SOURCE);
    Object.defineProperty(racedLoader, "toString", {
        configurable: true,
        value() {
            racedPayload._result = foreignLoader;
            return PLAYGROUND_LOADER_SOURCE;
        }
    });
    racedPayload._result = racedLoader;
    assert.equal(plugin.getPlaygroundLazyComponentType(racedLazy), racedLazy);
    assert.equal(racedPayload._result, foreignLoader);
    plugin.stop();
});

test("malformed public entry results fall back without throwing or patching", async () => {
    const invalidResults = [
        ["null", () => null],
        ["empty", () => []],
        ["multiple modules", () => [{default() {}}, {default() {}}]],
        ["missing target", () => [{unrelated() {}}]],
        ["ambiguous targets", () => [{first: withFunctionSource(function first() {}, PLAYGROUND_COMPONENT_SOURCE), second: withFunctionSource(function second() {}, PLAYGROUND_COMPONENT_SOURCE)}]],
        ["throwing getter", () => {
            const exports = {};
            Object.defineProperty(exports, "throwing", {enumerable: true, get() { throw new Error("getter"); }});
            return [exports];
        }],
        ["rejection", () => Promise.reject(new Error("entry failed"))],
        ["sync throw", () => { throw new Error("entry failed synchronously"); }]
    ];

    for (const [name, value] of invalidResults) {
        const {plugin} = startPlugin();
        const calls = [];
        installReactHarness(function loadEntry(source) {
            calls.push({receiver: this, source});
            return value();
        });
        assert.equal(await plugin.loadPlaygroundEntry(`invalid-${name}`), null, name);
        assert.equal(calls.length, 1, name);
        plugin.stop();
    }

    const {plugin} = startPlugin();
    installReactHarness();
    const unavailableLazy = playgroundLazy(withFunctionSource(function unavailableLoader() {}, PLAYGROUND_LOADER_SOURCE));
    delete BdApi.React;
    assert.equal(plugin.getPlaygroundLazyComponentType(unavailableLazy), unavailableLazy);
    installReactHarness();
    delete BdApi.Utils;
    assert.equal(plugin.getPlaygroundLazyComponentType(unavailableLazy), unavailableLazy);
    assert.equal(await plugin.loadPlaygroundEntry("missing-api"), null);
    plugin.stop();
});

test("nested playground traversal preserves props and avoids native loader calls", () => {
    const {plugin} = startPlugin();
    let nativeLoaderCalls = 0;
    const loader = withFunctionSource(function nativeLoader() {
        nativeLoaderCalls++;
        return null;
    }, PLAYGROUND_LOADER_SOURCE);
    const payload = {_status: -1, _result: loader};
    const lazyType = {$$typeof: Symbol.for("react.lazy"), _payload: payload};
    const unrelatedLazy = {$$typeof: Symbol.for("react.lazy"), _payload: {_status: -1, _result: loader}};
    const {React} = installReactHarness();
    const url = "dev://playground/example";
    const target = React.createElement(lazyType, {url, key: "target-key", ref: "target-ref", data: "keep"});
    target.props.ref = "modern-target-ref";
    const foreign = React.createElement(unrelatedLazy, {url: "dev://playground/other", key: "foreign-key"});
    const root = React.createElement("section", {className: "root", key: "root-key", ref: "root-ref"}, [target, foreign, "text"]);
    root.props.ref = "modern-root-ref";
    let refReads = 0;
    Object.defineProperty(root, "ref", {
        configurable: true,
        get() {
            refReads++;
            throw new Error("React 19 ref getter must not be read");
        }
    });

    const wrapped = plugin.wrapPlaygroundLazyElements(root, url);
    assert.notEqual(wrapped, root);
    assert.equal(wrapped.type, "section");
    assert.equal(wrapped.key, "root-key");
    assert.equal(wrapped.props.className, "root");
    assert.equal(wrapped.props.ref, "modern-root-ref");
    assert.equal(refReads, 0);
    assert.equal(nativeLoaderCalls, 0);
    assert.equal(payload._result, loader);

    const children = wrapped.props.children;
    assert.equal(children.length, 3);
    assert.notEqual(children[0].type, lazyType);
    assert.equal(children[0].key, "target-key");
    assert.equal(children[0].props.url, url);
    assert.equal(children[0].props.data, "keep");
    assert.equal(children[0].props.ref, "modern-target-ref");
    assert.equal(children[1], foreign);
    assert.equal(children[2], "text");
    assert.equal(plugin.wrapPlaygroundLazyElements(wrapped, url), wrapped);
    plugin.stop();
});

test("stopped runs cannot invoke or consume public playground loads", async () => {
    const harness = createHarness();
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    plugin.start();
    const component = withFunctionSource(function PlaygroundEmbed() {
        return harness.user.isStaff();
    }, PLAYGROUND_COMPONENT_SOURCE);
    const modules = Object.freeze({renamed: component});
    const calls = [];
    const resolvers = [];
    installReactHarness(function loadEntry(source) {
        calls.push({receiver: this, source});
        return new Promise(resolve => resolvers.push(resolve));
    });

    const firstLazy = playgroundLazy(withFunctionSource(function firstLoader() {}, PLAYGROUND_LOADER_SOURCE));
    const firstReplacement = plugin.getPlaygroundLazyComponentType(firstLazy);
    const firstBeforeStop = firstReplacement._factory();
    await settle();
    assert.equal(calls.length, 1);
    resolvers[0]([modules]);
    const firstResolved = await firstBeforeStop;
    assert.equal(firstResolved.default.call(harness.user), true);
    plugin.stop();
    assert.equal(harness.user.isStaff(), false);

    plugin.start();
    const stopBeforeCallLazy = playgroundLazy(withFunctionSource(function queuedLoader() {}, PLAYGROUND_LOADER_SOURCE));
    const stopBeforeCallReplacement = plugin.getPlaygroundLazyComponentType(stopBeforeCallLazy);
    const stopBeforeCall = stopBeforeCallReplacement._factory();
    plugin.stop();
    const stoppedModule = await stopBeforeCall;
    assert.equal(calls.length, 1);
    const stoppedProps = {url: "dev://playground/mana", marker: "queued"};
    const stoppedElement = stoppedModule.default(stoppedProps);
    assert.equal(stoppedElement.type, stopBeforeCallLazy);
    assert.deepEqual(stoppedElement.props, stoppedProps);

    plugin.start();
    const successorLazy = playgroundLazy(withFunctionSource(function successorLoader() {}, PLAYGROUND_LOADER_SOURCE));
    const successorReplacement = plugin.getPlaygroundLazyComponentType(successorLazy);
    const successorLoad = successorReplacement._factory();
    await settle();
    assert.equal(calls.length, 2);
    plugin.stop();
    plugin.start();
    resolvers[1]([modules]);
    const staleModule = await successorLoad;
    assert.equal(staleModule.default({url: "dev://playground/mana"}).type, successorLazy);
    assert.equal(firstResolved.default.call(harness.user), false);

    const currentLazy = playgroundLazy(withFunctionSource(function currentLoader() {}, PLAYGROUND_LOADER_SOURCE));
    const currentReplacement = plugin.getPlaygroundLazyComponentType(currentLazy);
    const currentLoad = currentReplacement._factory();
    await settle();
    assert.equal(calls.length, 3);
    resolvers[2]([modules]);
    const currentModule = await currentLoad;
    assert.equal(currentModule.default.call(harness.user), true);
    assert.equal(harness.user.isStaff(), false);
    plugin.stop();
});

test("reentrant public loader stop leaves no stale result or staff patch", async () => {
    const {harness, plugin} = startPlugin();
    const component = withFunctionSource(function PlaygroundEmbed() {
        return harness.user.isStaff();
    }, PLAYGROUND_COMPONENT_SOURCE);
    const calls = [];
    installReactHarness(function loadEntry(source) {
        calls.push({receiver: this, source});
        plugin.stop();
        return Promise.resolve([{renamed: component}]);
    });
    const lazyType = playgroundLazy(withFunctionSource(function reentrantLoader() {}, PLAYGROUND_LOADER_SOURCE));
    const replacement = plugin.getPlaygroundLazyComponentType(lazyType);
    const loaded = await replacement._factory();
    assert.equal(calls.length, 1);
    assert.equal(plugin.isRunning, false);
    assert.equal(loaded.default({url: "dev://playground/mana"}).type, lazyType);
    assert.equal(harness.user.isStaff(), false);
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
    const nativePattern = /^dev:\/\/experiment\/([-\w._0-9]+)(?:\/([0-9]+))?$/i;
    const helpers = {
        matchUrl(value) {
            return nativePattern.test(value);
        },
        readExperimentId(value) {
            const match = value.match(nativePattern);
            return match == null || match.length < 2 ? null : match[1];
        },
        readTreatment(value) {
            const match = value.match(nativePattern);
            return match == null || match.length < 3 ? NaN : parseInt(match[2], 10);
        },
        buildOptions(values) {
            return values.map(value => ({id: value.id, label: value.label, value: value.id}));
        }
    };
    harness.sourceModules.set('"^dev://experiment/', [{exports: helpers}]);
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});

    plugin.start();
    assert.equal(helpers.matchUrl("dev://experiment/example/-1"), true);
    assert.equal(helpers.readExperimentId("dev://experiment/example/-1"), "example");
    assert.equal(helpers.readTreatment("dev://experiment/example"), null);
    plugin.stop();
    assert.equal(helpers.matchUrl("dev://experiment/example/-1"), false);
    assert.equal(helpers.readExperimentId("dev://experiment/example/-1"), null);
    assert.equal(Number.isNaN(helpers.readTreatment("dev://experiment/example")), true);

    plugin.start();
    assert.equal(helpers.matchUrl("dev://experiment/example/-1"), true);
    assert.equal(helpers.readExperimentId("dev://experiment/example/-1"), "example");
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
