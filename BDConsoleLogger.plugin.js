/**
 * @name BDConsoleLogger
 * @author openAI
 * @version 1.0.0
 * @description Writes live renderer console output to BetterDiscord's channel-specific console.log file beside debug.log.
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/BDConsoleLogger.plugin.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CONSOLE_METHODS = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
    "dir",
    "dirxml",
    "group",
    "groupCollapsed",
    "groupEnd",
    "table",
    "count",
    "countReset",
    "time",
    "timeLog",
    "timeEnd",
    "assert",
    "clear"
];

const timestamp = () => new Date().toISOString().replace("T", " ").replace("Z", "");

const getCircularReplacer = () => {
    const seen = new WeakSet();

    return (_, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return "[Circular Reference]";
            seen.add(value);
        }

        return value;
    };
};

module.exports = class BDConsoleLogger {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || "BDConsoleLogger";
        this.consolePatches = [];
        this.boundOnError = this.onError.bind(this);
        this.boundOnUnhandledRejection = this.onUnhandledRejection.bind(this);
        this.boundOnProcessWarning = this.onProcessWarning.bind(this);
        this.boundOnProcessUnhandledRejection = this.onProcessUnhandledRejection.bind(this);
        this.boundOnProcessUncaughtException = this.onProcessUncaughtException.bind(this);
        this.stream = null;
        this.inspectorSession = null;
        this.captureMode = "unknown";
        this.channel = "stable";
        this.logFile = "";
        this.groupDepth = 0;
    }

    start() {
        try {
            this.channel = this.getReleaseChannel();
            this.logFile = this.getLogFile();

            if (!this.logFile) throw new Error("Could not resolve the BetterDiscord data folder.");

            fs.mkdirSync(path.dirname(this.logFile), {recursive: true});
            this.stream = fs.createWriteStream(this.logFile, {flags: "a", encoding: "utf8"});
            this.stream.write(`\n\n================= Starting Console Log (${timestamp()}) [${this.channel}] =================\n`);
            this.writeLine("PLUGIN", `Output file: ${this.logFile}`);
            window.addEventListener("error", this.boundOnError, true);
            window.addEventListener("unhandledrejection", this.boundOnUnhandledRejection, true);
            this.attachProcessListeners();
            this.captureMode = this.startInspectorCapture() ? "inspector" : "console-patch";
            this.writeLine("PLUGIN", `Capture mode: ${this.captureMode}`);
            if (this.captureMode === "console-patch") {
                const patchSummary = this.patchConsole();
                this.writeLine("PLUGIN", `Console hooks: ${patchSummary}`);
            }
            this.runHookProbe();
        }
        catch (error) {
            this.reportError("Failed to start plugin.", error);
            this.stop();
        }
    }

    stop() {
        this.stopInspectorCapture();
        this.restoreConsole();
        window.removeEventListener("error", this.boundOnError, true);
        window.removeEventListener("unhandledrejection", this.boundOnUnhandledRejection, true);
        this.detachProcessListeners();
        this.groupDepth = 0;

        if (this.stream) {
            try {
                this.stream.end(`================= Ending Console Log (${timestamp()}) [${this.channel}] =================\n\n`);
            }
            catch {}
        }

        this.stream = null;
    }

    getLogFile() {
        const root = this.getBetterDiscordRoot();
        if (!root) return "";
        return path.join(root, "data", this.channel, "console.log");
    }

    getBetterDiscordRoot() {
        const bdRoot = this.cleanPath(process.env.BETTERDISCORD_DATA_PATH);
        if (bdRoot) return bdRoot;
        return "";
    }

    getReleaseChannel() {
        const rawChannel = String(
            window.DiscordNative?.app?.getReleaseChannel?.()
            || process.env.DISCORD_RELEASE_CHANNEL
            || window.GLOBAL_ENV?.RELEASE_CHANNEL
            || "stable"
        ).trim().toLowerCase();

        if (!rawChannel || rawChannel === "discord" || rawChannel === "stable") return "stable";
        if (rawChannel.includes("canary")) return "canary";
        if (rawChannel.includes("ptb")) return "ptb";
        return "stable";
    }

    patchConsole() {
        const patched = [];
        const failed = [];

        for (const level of CONSOLE_METHODS) {
            const result = this.patchConsoleMethod(level);
            if (result) patched.push(level);
            else failed.push(level);
        }

        if (!patched.length) return `no methods patched; failed=${failed.join(", ") || "none"}`;
        if (!failed.length) return `patched=${patched.join(", ")}`;
        return `patched=${patched.join(", ")} failed=${failed.join(", ")}`;
    }

    restoreConsole() {
        for (const patch of this.consolePatches.splice(0).reverse()) {
            try {
                if (patch.hadOwnProperty) {
                    Object.defineProperty(patch.target, patch.level, patch.descriptor);
                }
                else {
                    delete patch.target[patch.level];
                }
            }
            catch {}
        }
    }

    onError(event) {
        const details = [
            `message=${event?.message ?? ""}`,
            `filename=${event?.filename ?? ""}`,
            `lineno=${event?.lineno ?? ""}`,
            `colno=${event?.colno ?? ""}`
        ];

        if (event?.error) details.push(this.stringifyValue(event.error));
        this.writeLine("WINDOW:ERROR", details.join(" | "));
    }

    onUnhandledRejection(event) {
        this.writeLine("WINDOW:UNHANDLEDREJECTION", this.stringifyValue(event?.reason));
    }

    attachProcessListeners() {
        if (!process?.on) return;

        process.on("warning", this.boundOnProcessWarning);
        process.on("unhandledRejection", this.boundOnProcessUnhandledRejection);
        process.on("uncaughtException", this.boundOnProcessUncaughtException);
    }

    detachProcessListeners() {
        if (!process?.off && !process?.removeListener) return;

        const remove = process.off ? process.off.bind(process) : process.removeListener.bind(process);
        remove("warning", this.boundOnProcessWarning);
        remove("unhandledRejection", this.boundOnProcessUnhandledRejection);
        remove("uncaughtException", this.boundOnProcessUncaughtException);
    }

    onProcessWarning(warning) {
        this.writeLine("PROCESS:WARNING", this.stringifyValue(warning));
    }

    onProcessUnhandledRejection(reason) {
        this.writeLine("PROCESS:UNHANDLEDREJECTION", this.stringifyValue(reason));
    }

    onProcessUncaughtException(error) {
        this.writeLine("PROCESS:UNCAUGHTEXCEPTION", this.stringifyValue(error));
    }

    startInspectorCapture() {
        try {
            const inspectorModule = this.getInspectorModule();
            if (!inspectorModule?.Session) {
                this.writeLine("PLUGIN", "Inspector module unavailable in this BetterDiscord runtime.");
                return false;
            }

            this.inspectorSession = new inspectorModule.Session();
            this.inspectorSession.connect();
            this.inspectorSession.on("Runtime.consoleAPICalled", (message) => {
                this.onInspectorConsole(message?.params || {});
            });
            this.inspectorSession.on("Runtime.exceptionThrown", (message) => {
                this.onInspectorException(message?.params || {});
            });
            this.inspectorSession.on("Log.entryAdded", (message) => {
                this.onInspectorLogEntry(message?.params?.entry || {});
            });

            this.postInspector("Runtime.enable");
            this.postInspector("Log.enable");
            return true;
        }
        catch (error) {
            this.writeLine("PLUGIN", `Inspector capture unavailable: ${this.stringifyValue(error)}`);
            this.stopInspectorCapture();
            return false;
        }
    }

    getInspectorModule() {
        const candidates = ["node:inspector", "inspector"];
        const loaders = [
            () => (typeof require === "function" ? require : null),
            () => (typeof process?.mainModule?.require === "function" ? process.mainModule.require.bind(process.mainModule) : null),
            () => {
                try {
                    return Function("return require")();
                }
                catch {
                    return null;
                }
            }
        ];

        for (const getLoader of loaders) {
            const loader = getLoader();
            if (!loader) continue;

            for (const request of candidates) {
                try {
                    return loader(request);
                }
                catch {}
            }
        }

        return null;
    }

    stopInspectorCapture() {
        if (!this.inspectorSession) return;

        try {
            this.inspectorSession.removeAllListeners("Runtime.consoleAPICalled");
            this.inspectorSession.removeAllListeners("Runtime.exceptionThrown");
            this.inspectorSession.removeAllListeners("Log.entryAdded");
            this.inspectorSession.disconnect();
        }
        catch {}

        this.inspectorSession = null;
    }

    postInspector(method, params) {
        if (!this.inspectorSession) return;

        try {
            this.inspectorSession.post(method, params || {}, (error) => {
                if (error) this.writeLine("PLUGIN", `Inspector ${method} failed: ${this.stringifyValue(error)}`);
            });
        }
        catch (error) {
            this.writeLine("PLUGIN", `Inspector ${method} threw: ${this.stringifyValue(error)}`);
        }
    }

    onInspectorConsole(params) {
        const level = String(params?.type || "log").toUpperCase();
        this.writeJson(`CDP:CONSOLE:${level}`, {
            type: params?.type || "log",
            timestamp: params?.timestamp,
            executionContextId: params?.executionContextId,
            args: Array.isArray(params?.args) ? params.args.map((arg) => this.serializeRemoteObject(arg)) : [],
            stackTrace: this.serializeStackTrace(params?.stackTrace),
            context: params?.context || ""
        });
    }

    onInspectorException(params) {
        this.writeJson("CDP:EXCEPTION", {
            timestamp: params?.timestamp,
            exceptionId: params?.exceptionDetails?.exceptionId,
            text: params?.exceptionDetails?.text || "",
            lineNumber: params?.exceptionDetails?.lineNumber,
            columnNumber: params?.exceptionDetails?.columnNumber,
            url: params?.exceptionDetails?.url || "",
            scriptId: params?.exceptionDetails?.scriptId || "",
            stackTrace: this.serializeStackTrace(params?.exceptionDetails?.stackTrace),
            exception: this.serializeRemoteObject(params?.exceptionDetails?.exception)
        });
    }

    onInspectorLogEntry(entry) {
        this.writeJson(`CDP:LOG:${String(entry?.level || "info").toUpperCase()}`, {
            source: entry?.source || "",
            level: entry?.level || "",
            text: entry?.text || "",
            url: entry?.url || "",
            lineNumber: entry?.lineNumber,
            timestamp: entry?.timestamp,
            args: Array.isArray(entry?.args) ? entry.args.map((arg) => this.serializeRemoteObject(arg)) : [],
            stackTrace: this.serializeStackTrace(entry?.stackTrace)
        });
    }

    patchConsoleMethod(level) {
        const hadOwnProperty = Object.prototype.hasOwnProperty.call(console, level);
        const descriptor = hadOwnProperty ? Object.getOwnPropertyDescriptor(console, level) : null;
        const original = console[level];
        if (typeof original !== "function") return false;

        const wrapper = (...args) => {
            this.handleConsoleCall(level, args);
            return original.apply(console, args);
        };

        try {
            Object.defineProperty(console, level, {
                configurable: true,
                enumerable: descriptor ? descriptor.enumerable : true,
                writable: true,
                value: wrapper
            });

            if (console[level] !== wrapper) return false;

            this.consolePatches.push({
                level,
                target: console,
                hadOwnProperty,
                descriptor
            });
            return true;
        }
        catch (error) {
            this.writeLine("PLUGIN", `Failed to patch console.${level}: ${this.stringifyValue(error)}`);
            return false;
        }
    }

    runHookProbe() {
        try {
            console.debug("[BDConsoleLogger] hook probe", {captureMode: this.captureMode});
        }
        catch (error) {
            this.writeLine("PLUGIN", `Hook probe failed: ${this.stringifyValue(error)}`);
        }
    }

    handleConsoleCall(level, args) {
        if (level === "group" || level === "groupCollapsed") {
            this.writeLine(`CONSOLE:${level.toUpperCase()}`, this.sanitize(...args));
            this.groupDepth += 1;
            return;
        }

        if (level === "groupEnd") {
            this.groupDepth = Math.max(0, this.groupDepth - 1);
            this.writeLine("CONSOLE:GROUPEND", "");
            return;
        }

        if (level === "assert") {
            if (args[0]) return;
            const assertArgs = args.length > 1 ? args.slice(1) : ["Assertion failed"];
            this.writeLine("CONSOLE:ASSERT", this.sanitize(...assertArgs));
            return;
        }

        this.writeLine(`CONSOLE:${level.toUpperCase()}`, this.sanitize(...args));
    }

    sanitize(...args) {
        const parts = [];

        for (let index = 0; index < args.length; index++) {
            const value = args[index];

            if (typeof value === "string") {
                const styleCount = this.countOccurrences(value, "%c");
                parts.push(value.replace(/%c/g, ""));
                if (styleCount > 0) index += styleCount;
                continue;
            }

            if (typeof value === "undefined") {
                parts.push("undefined");
                continue;
            }

            parts.push(this.stringifyValue(value));
        }

        return parts.join(" ");
    }

    stringifyValue(value) {
        if (value instanceof Error) {
            return `${value.message}\n${value.stack || ""}`.trim();
        }

        if (typeof value === "bigint" || typeof value === "boolean" || typeof value === "function" || typeof value === "number" || typeof value === "symbol") {
            return String(value);
        }

        if (typeof value === "string") return value;

        try {
            return JSON.stringify(value, getCircularReplacer());
        }
        catch {}

        try {
            return String(value);
        }
        catch {
            return "[Unstringifiable]";
        }
    }

    writeLine(label, message) {
        if (!this.stream) return;

        try {
            const indent = this.groupDepth > 0 ? `${"  ".repeat(this.groupDepth)}` : "";
            this.stream.write(`[${timestamp()}][${label}] ${indent}${message}\n`);
        }
        catch {}
    }

    writeJson(label, payload) {
        this.writeLine(label, JSON.stringify(payload, getCircularReplacer()));
    }

    countOccurrences(source, needle) {
        if (!source || !needle) return 0;
        return source.split(needle).length - 1;
    }

    cleanPath(value) {
        return typeof value === "string" && value.trim() ? value.trim() : "";
    }

    serializeRemoteObject(value) {
        if (!value || typeof value !== "object") return value;
        if ("value" in value && value.value !== undefined) return value.value;
        if ("unserializableValue" in value && value.unserializableValue !== undefined) return value.unserializableValue;

        const serialized = {
            type: value.type || "",
            subtype: value.subtype || "",
            className: value.className || "",
            description: value.description || ""
        };

        if (value.preview) {
            serialized.preview = {
                type: value.preview.type || "",
                subtype: value.preview.subtype || "",
                description: value.preview.description || "",
                overflow: !!value.preview.overflow,
                properties: Array.isArray(value.preview.properties) ? value.preview.properties.map((property) => ({
                    name: property.name,
                    type: property.type,
                    value: property.value
                })) : []
            };
        }

        return serialized;
    }

    serializeStackTrace(stackTrace) {
        if (!stackTrace || !Array.isArray(stackTrace.callFrames)) return [];
        return stackTrace.callFrames.map((frame) => ({
            functionName: frame.functionName || "",
            url: frame.url || "",
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber
        }));
    }

    reportError(message, error) {
        const originalError = typeof console.error === "function" ? console.error : null;

        try {
            originalError?.call(console, `[${this.pluginName}] ${message}`, error);
        }
        catch {}
    }
};
