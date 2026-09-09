"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Experiments = require("../Experiments.plugin.js");
const semanticDecoyPattern = /not-used/;

function createHarness() {
    const patches = [];
    const waits = [];
    const sourceModules = new Map();
    const moduleFactories = new Map();
    let nextHandle = 1;
    const intervals = new Map();

    const user = {
        flags: 0,
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
        storeDidChange() {},
        actionHandler: {
            CONNECTION_OPEN() {
                return "opened";
            }
        }
    };
    const developerExperimentStore = {
        name: "DeveloperExperimentStore",
        storeDidChange() {},
        actionHandler: {
            CONNECTION_OPEN() {
                return "opened";
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
        instead(plugin, target, method, callback) {
            const record = {plugin, target, method, next: target[method], wrapper: null};
            record.wrapper = function (...args) {
                return callback(this, args, (...originalArgs) => record.next.apply(this, originalArgs));
            };
            target[method] = record.wrapper;
            patches.push(record);
        },
        after(plugin, target, method, callback) {
            const record = {plugin, target, method, next: target[method], wrapper: null};
            record.wrapper = function (...args) {
                const result = record.next.apply(this, args);
                const patched = callback(this, args, result);
                return patched === undefined ? result : patched;
            };
            target[method] = record.wrapper;
            patches.push(record);
        },
        unpatchAll(plugin) {
            for (let index = patches.length - 1; index >= 0; index--) {
                const record = patches[index];
                if (record.plugin !== plugin) continue;
                if (record.target[record.method] === record.wrapper) record.target[record.method] = record.next;
                else {
                    const outer = patches.find(candidate => candidate.next === record.wrapper);
                    if (outer) outer.next = record.next;
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
        setTimeout() {
            return nextHandle++;
        },
        clearTimeout() {},
        requestAnimationFrame() {
            return nextHandle++;
        },
        cancelAnimationFrame() {},
        getComputedStyle() {
            return {overflowY: "visible"};
        }
    };
    global.document = {
        body: {},
        head: {appendChild() {}},
        addEventListener() {},
        removeEventListener() {},
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
        observe() {}
        disconnect() {}
    };
    Object.defineProperty(global, "navigator", {
        configurable: true,
        value: {platform: "MacIntel"}
    });
    global.BdApi = {
        Data: {
            load() {
                return undefined;
            },
            save() {}
        },
        DOM: {
            addStyle() {},
            removeStyle() {}
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

    return {experimentStore, waits, sourceModules, moduleFactories, patcher};
}

function createPlugin(harness) {
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    plugin.start();
    return plugin;
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

function rawModule(harness, id, exports, source) {
    harness.moduleFactories.set(id, source);
    return {id, exports};
}

function createHelpers(calls = []) {
    const nativePattern = /^dev:\/\/experiment\/([-\w._0-9]+)(?:\/([0-9]+))?$/i;
    return {
        renamedMatcher(value) {
            calls.push({name: "matcher", receiver: this, args: [...arguments]});
            return nativePattern.test(value);
        },
        renamedId(value) {
            calls.push({name: "id", receiver: this, args: [...arguments]});
            if (value === "native") return "native-id";
            const match = value.match(nativePattern);
            return match == null || match.length < 2 ? null : match[1];
        },
        renamedTreatment(value) {
            calls.push({name: "treatment", receiver: this, args: [...arguments]});
            if (value === "native") return 7;
            if (value === "throw") throw new Error("native treatment failure");
            const match = value.match(nativePattern);
            return match == null || match.length < 3 ? NaN : parseInt(match[2], 10);
        },
        renamedOptions(descriptor) {
            calls.push({name: "options", receiver: this, args: [...arguments]});
            return descriptor.variants.map(row => ({id: row.id, label: row.label, value: row.id}));
        }
    };
}

function installLoadedHelper(harness, helpers, id = "url-helper") {
    harness.sourceModules.set('"^dev://experiment/', [{id, exports: helpers}]);
}

function descriptorFor(experimentId = "exp42") {
    return experiment => experiment === experimentId ? {
        system: "legacy",
        variants: [
            {id: -1, label: "Not Eligible"},
            {id: 0, label: "Zero"},
            {id: 2, label: "Beta Test"}
        ]
    } : null;
}

test("public start patches renamed semantic URL helpers and preserves native calls", () => {
    const harness = createHarness();
    const calls = [];
    const helpers = createHelpers(calls);
    installLoadedHelper(harness, helpers);
    const plugin = createPlugin(harness);
    plugin.resolveExperimentForTreatmentOptions = descriptorFor();
    const receiver = {name: "receiver"};

    assert.equal(helpers.renamedMatcher.call(receiver, "dev://experiment/exp42/-2", "extra"), true);
    assert.equal(helpers.renamedId.call(receiver, "dev://experiment/exp42/-2", "extra"), "exp42");
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/0", "extra"), 0);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/-2", "extra"), -2);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/2", "extra"), 2);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/zero", "extra"), 0);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/Beta%20Test", "extra"), 2);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/Beta-Test", "extra"), 2);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/unknown", "extra"), null);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42", "extra"), null);
    assert.equal(helpers.renamedTreatment.call(receiver, "other://exp42/2", "extra"), null);
    assert.equal(helpers.renamedTreatment.call(receiver, "dev://experiment/exp42/%E0%A4%A", "extra"), null);
    assert.equal(helpers.renamedTreatment.call(receiver, "native", "extra"), 7);
    assert.throws(() => helpers.renamedTreatment.call(receiver, "throw", "extra"), /native treatment failure/);

    const treatmentCalls = calls.filter(call => call.name === "treatment");
    assert.equal(treatmentCalls.at(-1).receiver, receiver);
    assert.deepEqual(treatmentCalls.at(-1).args, ["throw", "extra"]);
    const optionCall = calls.find(call => call.name === "options");
    assert.equal(optionCall.receiver, helpers);
    assert.equal(optionCall.args[0].system, "legacy");
    plugin.stop();
});

test("semantic core ambiguity and nonsemantic decoys do not patch or execute candidates", () => {
    const harness = createHarness();
    const decoy = {
        unrelated() {
            throw new Error("decoy executed");
        }
    };
    installLoadedHelper(harness, decoy, "decoy");
    const plugin = createPlugin(harness);
    assert.equal(plugin.getExperimentUrlHelperSelection(decoy), null);

    let executions = 0;
    const ambiguous = createHelpers();
    ambiguous.firstMatcher = function firstMatcher(value) {
        executions++;
        return semanticDecoyPattern.test(value);
    };
    ambiguous.secondMatcher = function secondMatcher(value) {
        executions++;
        return semanticDecoyPattern.test(value);
    };
    installLoadedHelper(harness, ambiguous, "ambiguous");
    plugin.patchExperimentUrlHelperModule(ambiguous);
    assert.equal(plugin.getExperimentUrlHelperSelection(ambiguous), null);
    assert.equal(executions, 0);
    assert.equal(ambiguous.renamedMatcher("dev://experiment/exp42/-1"), false);
    plugin.stop();
});

test("semantic selectors reject length-prefix decoys and accept parenthesized option callbacks", () => {
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    const idDecoy = function idDecoy(value) {
        const match = value.match(/unused/);
        return match == null || match.length < 20 ? null : match[1];
    };
    const treatmentDecoy = function treatmentDecoy(value) {
        const match = value.match(/unused/);
        return match == null || match.length < 30 ? null : parseInt(match[2], 10);
    };
    const parenthesizedOptions = function parenthesizedOptions(rows) {
        return rows.map((row) => ({id: row.id, label: row.label, value: row.id}));
    };

    assert.equal(plugin.isExperimentUrlIdHelper(idDecoy), false);
    assert.equal(plugin.isExperimentUrlTreatmentHelper(treatmentDecoy), false);
    assert.equal(plugin.isExperimentUrlOptionsHelper(parenthesizedOptions), true);
});

test("semantic selectors accept $-prefixed and $match-prefixed match variables", () => {
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});

    const idDollar = function idDollar(value) {
        const pattern = /unused/;
        const $ = value.match(pattern);
        return $ == null || $.length < 2 ? null : $[1];
    };
    const treatmentDollarMatch = function treatmentDollarMatch(value) {
        const pattern = /unused/;
        const $match = value.match(pattern);
        return $match == null || $match.length < 3 ? NaN : parseInt($match[2], 10);
    };
    const prefixCollision = function prefixCollision(value) {
        const patternPrefix = /unused/;
        const patternSuffix = /unused/;
        const $matchPrefix = value.match(patternPrefix);
        const $matchSuffix = value.match(patternSuffix);
        return $matchPrefix == null || $matchPrefix.length < 3 ? NaN : parseInt($matchSuffix[2], 10);
    };

    assert.equal(plugin.isExperimentUrlIdHelper(idDollar), true);
    assert.equal(plugin.isExperimentUrlTreatmentHelper(treatmentDollarMatch), true);
    assert.equal(plugin.isExperimentUrlIdHelper(prefixCollision), false);
    assert.equal(plugin.isExperimentUrlTreatmentHelper(prefixCollision), false);
});

test("helpers without options still support numeric fallback and native zero", () => {
    const harness = createHarness();
    const helpers = createHelpers();
    delete helpers.renamedOptions;
    installLoadedHelper(harness, helpers);
    const plugin = createPlugin(harness);
    assert.equal(helpers.renamedTreatment("dev://experiment/exp42/0"), 0);
    assert.equal(helpers.renamedTreatment("dev://experiment/exp42/-9"), -9);
    assert.equal(helpers.renamedTreatment("dev://experiment/exp42/Beta"), null);
    plugin.stop();
});

test("lazy URL helper waiter rejects decoys, is cancellable, and patches a successor run", async () => {
    const harness = createHarness();
    const plugin = createPlugin(harness);
    const wait = harness.waits.find(candidate => candidate.options?.searchExports === false
        && candidate.options?.searchDefault === false
        && candidate.filter({}, {id: "missing"}, "missing") === false);
    assert.ok(wait);
    assert.deepEqual(
        Object.fromEntries(["raw", "searchExports", "searchDefault", "fatal"].map(key => [key, wait.options[key]])),
        {raw: true, searchExports: false, searchDefault: false, fatal: false}
    );

    const decoy = rawModule(harness, "decoy", {unrelated() {}}, 'module("^dev://experiment/")');
    assert.equal(wait.filter(decoy.exports, decoy, decoy.id), false);

    const helpers = createHelpers();
    const late = rawModule(harness, "late", helpers, 'module("^dev://experiment/")');
    assert.equal(wait.filter(late.exports, late, late.id), true);
    wait.resolve(late);
    plugin.stop();
    await settle();
    assert.equal(helpers.renamedMatcher("dev://experiment/exp42/-1"), false);

    plugin.start();
    const successorWait = harness.waits.find(candidate => candidate !== wait
        && candidate.options?.searchExports === false
        && candidate.options?.searchDefault === false
        && candidate.filter(late.exports, late, late.id));
    assert.notEqual(successorWait, wait);
    successorWait.resolve(late);
    await settle();
    assert.equal(helpers.renamedMatcher("dev://experiment/exp42/-1"), true);
    plugin.stop();
});

test("same instance reuses semantic helper discovery after stop and restart", () => {
    const harness = createHarness();
    const helpers = createHelpers();
    installLoadedHelper(harness, helpers);
    const plugin = createPlugin(harness);
    assert.equal(helpers.renamedMatcher("dev://experiment/exp42/-1"), true);
    plugin.stop();
    assert.equal(helpers.renamedMatcher("dev://experiment/exp42/-1"), false);
    plugin.start();
    assert.equal(helpers.renamedMatcher("dev://experiment/exp42/-1"), true);
    plugin.stop();
});
