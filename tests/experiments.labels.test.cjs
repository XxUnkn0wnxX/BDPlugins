"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Experiments = require("../Experiments.plugin.js");

function createPlugin(stores) {
    const plugin = new Experiments({name: "Experiments", version: "1.6.2"});
    plugin.getStore = (name) => stores?.[name] || null;
    return plugin;
}

test("findExperimentTreatmentByLabel uses resolver output with legacy descriptions and returns numeric ids", () => {
    const experimentId = "legacy-exp";
    const legacyStore = {
        getRegisteredExperiments() {
            return {
                [experimentId]: {
                    buckets: [-1, 0, 1],
                    description: ["Not Eligible", "Zero", "One"]
                }
            };
        }
    };
    const plugin = createPlugin({ExperimentStore: legacyStore});
    let helperThis = null;
    let helperDescriptor = null;

    const helpers = {
        hp(descriptor) {
            helperThis = this;
            helperDescriptor = descriptor;
            return descriptor.variants.map(option => ({
                id: option.id,
                label: option.label,
                value: option.id
            }));
        }
    };

    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, experimentId, "not eligible"), -1);
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, experimentId, "one"), 1);
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, experimentId, "zero"), 0);
    assert.equal(helperThis, helpers);
    assert.equal(helperDescriptor?.system, "legacy");
    assert.deepEqual(helperDescriptor?.variants, [
        {id: -1, label: "Not Eligible"},
        {id: 0, label: "Zero"},
        {id: 1, label: "One"}
    ]);
});

test("findExperimentTreatmentByLabel resolves apex variants via resolver and supports custom helper key", () => {
    const experimentId = "apex-exp";
    const apexStore = {
        getExperimentsMetadata() {
            return {
                [experimentId]: {
                    variants: [
                        {id: 2, label: "Beta"},
                        {id: 4, label: "Delta"}
                    ]
                }
            };
        },
        getRegisteredExperiments() {
            return {
                [experimentId]: {
                    variations: {
                        "1": {},
                        "3": {},
                        "-1": {}
                    }
                }
            };
        }
    };
    const plugin = createPlugin({ApexExperimentStore: apexStore});

    let helperCallCount = 0;
    const helpers = {
        hp() {
            helperCallCount++;
            return [];
        },
        custom(descriptor) {
            helperCallCount++;
            assert.equal(this, helpers);
            assert.equal(descriptor.system, "apex");
            assert.deepEqual(descriptor.variants.slice(0, 4).map(option => option.id), [-1, 1, 2, 3]);
            return [
                {id: -1, label: "Not Eligible"},
                {id: 1, value: 1, label: "Variant 1"},
                {id: 2, label: "Variant 2: Beta"},
                {id: 3, label: "Variant 3"}
            ];
        }
    };

    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, experimentId, "not eligible", "custom"), -1);
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, experimentId, "variant2beta", "custom"), 2);
    assert.equal(helperCallCount, 2);
});

test("findExperimentTreatmentByLabel never invokes helper for unknown experiments", () => {
    const plugin = createPlugin({});
    let helperCalls = 0;
    const helpers = {
        hp() {
            helperCalls++;
            return [{id: 1, label: "One"}];
        }
    };

    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "missing", "one"), null);
    assert.equal(helperCalls, 0);
});

test("findExperimentTreatmentByLabel handles missing and malformed helper responses safely", () => {
    const experimentId = "legacy-exp";
    const legacyStore = {
        getRegisteredExperiments() {
            return {
                [experimentId]: {
                    buckets: [0],
                    description: ["Zero"]
                }
            };
        }
    };
    const plugin = createPlugin({ExperimentStore: legacyStore});

    assert.equal(plugin.findExperimentTreatmentByLabel({}, experimentId, "zero"), null);

    const throwingHelpers = {
        hp() {
            throw new Error("helper failed");
        }
    };
    assert.equal(plugin.findExperimentTreatmentByLabel(throwingHelpers, experimentId, "zero"), null);

    const nonArrayHelpers = {
        hp() {
            return {id: 1, label: "One"};
        }
    };
    assert.equal(plugin.findExperimentTreatmentByLabel(nonArrayHelpers, experimentId, "zero"), null);
});

test("an unknown label in a known experiment never falls back to control or coerces malformed ids", () => {
    const plugin = createPlugin({ExperimentStore: {
        getRegisteredExperiments: () => ({known: {buckets: [0, 1], description: ["Control", "One"]}})
    }});
    const nativeOptions = descriptor => descriptor.variants.map(option => ({...option, value: option.id}));
    assert.equal(plugin.findExperimentTreatmentByLabel({hp: nativeOptions}, "known", "missing label"), null);
    assert.equal(plugin.findExperimentTreatmentByLabel({hp: () => []}, "known", "one"), null);
    for (const value of [null, undefined, "", "1", false, true, NaN, Infinity, {}]) {
        assert.equal(plugin.findExperimentTreatmentByLabel({hp: () => [{label: "One", value}]}, "known", "one"), null);
    }
    const throwingHelper = Object.defineProperty({}, "hp", {get() { throw Error("helper getter"); }});
    assert.equal(plugin.findExperimentTreatmentByLabel(throwingHelper, "known", "one"), null);
    const throwingOption = Object.defineProperty({}, "label", {get() { throw Error("option getter"); }});
    assert.equal(plugin.findExperimentTreatmentByLabel({hp: () => [throwingOption]}, "known", "one"), null);
});

test("legacy labels delegate missing indexed descriptions to the native bucket utility", () => {
    const definition = Object.freeze({buckets: Object.freeze([-1, 0, 7]), description: "default bucket labels"});
    const plugin = createPlugin({ExperimentStore: {getRegisteredExperiments: () => ({known: definition})}});
    const reads = [];
    const utility = {
        getExperimentBucketName(id) { reads.push({receiver: this, id}); return `Native bucket ${id}`; },
        experimentDescriptorEquals() { throw Error("must not invoke during discovery"); }
    };
    plugin.getWebpackModule = (filter, options) => {
        assert.equal(filter(utility), true);
        assert.equal(filter({getExperimentBucketName() {}}), false);
        assert.equal(options.searchExports, true);
        return utility;
    };
    const helpers = {hp: descriptor => descriptor.variants.map(option => ({...option, value: option.id}))};
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "native bucket 7"), 7);
    assert.deepEqual(reads.map(read => read.id), [-1, 0, 7]);
    assert.ok(reads.every(read => read.receiver === utility));
    plugin.getWebpackModule = () => null;
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "native bucket 7"), null);
});

test("registered Apex variants remain usable without metadata and legacy definitions take precedence", () => {
    const registered = Object.freeze({variations: Object.freeze({0: {}, 3: {}})});
    const stores = {ApexExperimentStore: {
        getExperimentsMetadata: () => ({}),
        getRegisteredExperiments: () => ({known: registered})
    }};
    const plugin = createPlugin(stores);
    const helpers = {hp(descriptor) {
        const variants = descriptor.system === "apex"
            ? [{id: -1, label: "Not Eligible"}, ...descriptor.variants] : descriptor.variants;
        return variants.map(option => ({...option, value: option.id}));
    }};
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "variant 3"), 3);
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "not eligible"), -1);
    stores.ExperimentStore = {getRegisteredExperiments: () => ({known: {buckets: [7], description: ["Legacy label"]}})};
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "legacy label"), 7);
    assert.equal(plugin.findExperimentTreatmentByLabel(helpers, "known", "variant 3"), null);
});

test("descriptor lookup ignores inherited ids and fails safely on malformed store data", () => {
    const inherited = Object.create({inherited: {buckets: [1], description: ["One"]}});
    const stores = {ExperimentStore: {getRegisteredExperiments: () => inherited}};
    const plugin = createPlugin(stores);
    assert.equal(plugin.resolveExperimentForTreatmentOptions("inherited"), null);
    assert.equal(plugin.resolveExperimentForTreatmentOptions("constructor"), null);
    inherited.invalid = {buckets: [Infinity], description: ["Invalid"]};
    assert.equal(plugin.resolveExperimentForTreatmentOptions("invalid"), null);
    stores.ExperimentStore.getRegisteredExperiments = () => {throw Error("unavailable");};
    stores.ApexExperimentStore = {
        getExperimentsMetadata: () => ({invalid: {variants: null}}),
        getRegisteredExperiments: () => ({invalid: {variations: {1: {}}}})
    };
    assert.equal(plugin.resolveExperimentForTreatmentOptions("invalid"), null);
    assert.equal(plugin.resolveExperimentForTreatmentOptions("missing"), null);
});
