"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Experiments = require("../Experiments.plugin.js");
const denied = () => Object.assign(new Error("GET /apex/experiments/metadata [403]"), {name: "HTTPResponseError"});

function harness(log = function (...args) { return {receiver: this, args}; }) {
    const logger = {log};
    global.window = {console: logger};
    global.BdApi = {Patcher: {unpatchAll() {}}};
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    for (const method of ["showChangelogIfNeeded", "injectStyles", "resolveInternals", "patchUserStore",
        "patchExperimentStores", "patchExperimentGuards", "startStaffHelpClickBlocker", "ensureExperiments",
        "startDomObserver", "queueEnsureWarningCard", "showToast", "stopStaffHelpClickBlocker",
        "restoreLazyPayloads", "restoreForcedMembers", "restoreUserFlags", "flushExperimentStores",
        "removeWarningCard", "removeStyles", "reportError"]) plugin[method] = () => {};
    plugin.loadSettings = () => ({});
    return {plugin, logger, original: log};
}

test("the exact native denial is suppressed before both console output and BD's after capture", () => {
    const output = [], debugLog = [];
    const {plugin, logger} = harness(function (...args) {
        output.push(args);
        // BD's shared patch dispatcher records after callbacks even if an instead hook skipped output.
        debugLog.push(args);
    });
    plugin.start();
    const run = plugin.activeRun;
    assert.equal(logger.log(denied()), undefined);
    assert.equal(run.suppressedMetadata403, 1);
    assert.deepEqual(output, []);
    assert.deepEqual(debugLog, []);
    logger.log("ordinary message");
    assert.deepEqual(output, [["ordinary message"]]);
    assert.deepEqual(debugLog, output);
    plugin.stop();
});

test("other endpoints, statuses, methods, levels and argument shapes preserve their exact call", () => {
    const {plugin, logger} = harness();
    const receiver = {};
    const otherLevel = logger.warn = logger.log;
    plugin.start();
    const run = plugin.activeRun;
    const cases = [[], ["GET /apex/experiments/metadata [403]"], [null], [undefined],
        [new Error("GET /apex/experiments/metadata [403]")], [denied(), "context"],
        [Object.assign(denied(), {message: "GET /apex/experiments [403]"})],
        [Object.assign(denied(), {message: "GET /apex/experiments/metadata [500]"})],
        [Object.assign(denied(), {message: "POST /apex/experiments/metadata [403]"})],
        [Object.assign(denied(), {message: "GET /apex/experiments/metadata [403] extra"})],
        ["AnalyticsTrackingStore", "terminated request"]];
    for (const args of cases) {
        const actual = logger.log.apply(receiver, args);
        assert.equal(actual.receiver, receiver);
        assert.deepEqual(actual.args, args);
    }
    assert.equal(logger.warn, otherLevel);
    assert.equal(logger.warn(denied()).args.length, 1);
    assert.equal(run.suppressedMetadata403, 0);
    plugin.stop();
});

test("throwing property getters delegate safely and underlying logger failures propagate", () => {
    const sentinel = new Error("logger failure");
    const {plugin, logger} = harness(function (...args) {
        if (args[0] === "throw") throw sentinel;
        return args;
    });
    plugin.start();
    const hostile = Object.defineProperty({}, "name", {get() { throw Error("getter"); }});
    assert.equal(logger.log(hostile)[0], hostile);
    assert.throws(() => logger.log("throw"), error => error === sentinel);
    plugin.stop();
});

test("stop restores the previous logger; stale wrappers delegate and restart owns a fresh count", () => {
    const {plugin, logger, original} = harness();
    plugin.start();
    const first = plugin.activeRun;
    const wrapper = logger.log;
    plugin.installMetadataLogFilter(first);
    assert.equal(logger.log, wrapper);
    wrapper(denied());
    plugin.stop();
    assert.equal(logger.log, original);
    assert.equal(first.metadataLogFilter, null);
    assert.equal(wrapper(denied()).args.length, 1);
    assert.equal(first.suppressedMetadata403, 1);
    plugin.start();
    assert.equal(plugin.activeRun.suppressedMetadata403, 0);
    logger.log(denied());
    assert.equal(plugin.activeRun.suppressedMetadata403, 1);
    assert.equal(wrapper(denied()).args.length, 1);
    plugin.stop();
    assert.equal(logger.log, original);
});

test("cleanup preserves a later foreign wrapper and leaves retained filtering inactive", () => {
    const {plugin, logger} = harness();
    plugin.start();
    const owned = logger.log;
    const foreign = function (...args) { return owned.apply(this, args); };
    logger.log = foreign;
    plugin.stop();
    assert.equal(logger.log, foreign);
    assert.equal(logger.log(denied()).args.length, 1);
});

test("startup failure removes the installed filter and unavailable loggers do not break startup", () => {
    const {plugin, logger, original} = harness();
    plugin.resolveInternals = () => { throw Error("startup failed"); };
    plugin.start();
    assert.equal(logger.log, original);
    assert.equal(plugin.activeRun, null);
    for (const unavailable of [undefined, {}, Object.freeze({log: original})]) {
        const setup = harness();
        window.console = unavailable;
        setup.plugin.start();
        assert.equal(setup.plugin.isRunning, true);
        assert.equal(setup.plugin.activeRun.metadataLogFilter, null);
        setup.plugin.stop();
    }
});
