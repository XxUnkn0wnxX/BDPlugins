/**
 * @name JumpToTop
 * @author openAI
 * @version 2.0.1
 * @description Adds a channel header button that jumps to the first message in the current channel.
 * @source https://github.com/XxUnkn0wnxX/BDPlugins/tree/main
 * @updateUrl https://raw.githubusercontent.com/XxUnkn0wnxX/BDPlugins/main/JumpToTop.plugin.js
 */

"use strict";

module.exports = class JumpToTop {
    constructor(meta) {
        this.meta = meta ?? {};
        this.pluginName = this.meta.name || "JumpToTop";
        this.version = this.meta.version || "2.0.1";
        this.styleId = `${this.pluginName}-style`;
        this.buttonSelector = '[data-jump-to-top="true"]';
        this.buttonClass = "jump-to-top-button";
        this.label = "Jump to first message";
        this.lastRoute = "";
        this.renderQueued = false;
        this.transitionTo = null;

        this.scheduleEnsureButton = this.scheduleEnsureButton.bind(this);
        this.onRouteChange = this.onRouteChange.bind(this);
    }

    start() {
        try {
            this.showChangelogIfNeeded();
            this.injectStyles();
            this.scheduleEnsureButton();

            this.observer = new MutationObserver(() => this.scheduleEnsureButton());
            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            this.interval = window.setInterval(() => this.scheduleEnsureButton(), 1500);
            window.addEventListener("popstate", this.onRouteChange);
        }
        catch (error) {
            console.error("[JumpToTop] Failed to start plugin.", error);
        }
    }

    stop() {
        window.removeEventListener("popstate", this.onRouteChange);

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.renderQueued = false;
        this.lastRoute = "";
        this.removeButton();
        this.removeStyles();
    }

    onRouteChange() {
        this.scheduleEnsureButton();
    }

    getChangelog() {
        return {
            title: `${this.pluginName} has been updated!`,
            subtitle: `v${this.version}`,
            changes: [
                {
                    title: "Fixed",
                    type: "fixed",
                    items: [
                        "Stopped the button from appearing on non-message pages such as server boost pages.",
                        "Limited the button to DMs, channels, threads, forums, and message permalink routes."
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
            console.error("[JumpToTop] Failed to show changelog.", error);
        }
    }

    scheduleEnsureButton() {
        if (this.renderQueued) return;

        this.renderQueued = true;
        window.requestAnimationFrame(() => {
            this.renderQueued = false;
            this.ensureButton();
        });
    }

    getStyleText() {
        return `
            ${this.buttonSelector} {
                color: var(--interactive-normal);
            }

            ${this.buttonSelector}:hover {
                color: var(--interactive-hover);
            }

            ${this.buttonSelector}:focus-visible {
                outline: 2px solid var(--focus-primary);
                outline-offset: 2px;
                border-radius: 4px;
            }
        `;
    }

    injectStyles() {
        const css = this.getStyleText();
        const bdDom = BdApi?.DOM;

        if (bdDom?.addStyle && bdDom?.removeStyle) {
            bdDom.removeStyle(this.styleId);
            bdDom.addStyle(this.styleId, css);
            return;
        }

        if (document.getElementById(this.styleId)) return;

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

        const style = document.getElementById(this.styleId);
        if (style) style.remove();
    }

    ensureButton() {
        const route = this.getChannelRoute();
        this.lastRoute = route || "";

        if (!route) {
            this.removeButton();
            return;
        }

        const toolbar = this.getToolbar();
        if (!toolbar) return;

        let button = document.querySelector(this.buttonSelector);
        if (button && button.parentElement !== toolbar) {
            button.remove();
            button = null;
        }

        if (!button) {
            button = this.createButton(toolbar);
            if (!button) return;

            const searchButton = toolbar.querySelector('[class*="search"]');
            if (searchButton) searchButton.before(button);
            else toolbar.appendChild(button);
        }

        button.setAttribute("title", this.label);
        button.setAttribute("aria-label", this.label);
    }

    removeButton() {
        for (const button of document.querySelectorAll(this.buttonSelector)) {
            button.remove();
        }
    }

    getChannelRoute() {
        const match = window.location.pathname.match(/^\/channels\/(@me|\d+)\/(\d+)(?:\/\d+)?\/?$/);
        if (!match) return null;

        return `/channels/${match[1]}/${match[2]}`;
    }

    getToolbar() {
        return (
            document.querySelector('section [class*="search"]')?.parentElement ||
            document.querySelector('section [class*="toolbar"]') ||
            document.querySelector('header [class*="toolbar"]')
        );
    }

    createButton(toolbar) {
        const template = toolbar.querySelector('[class*="iconWrapper"]');
        const button = template ? template.cloneNode(true) : document.createElement("button");

        button.dataset.jumpToTop = "true";
        button.classList.add(this.buttonClass);
        button.removeAttribute("id");
        button.removeAttribute("aria-controls");
        button.removeAttribute("aria-expanded");
        button.removeAttribute("aria-haspopup");
        button.setAttribute("aria-label", this.label);
        button.setAttribute("role", "button");
        button.setAttribute("tabindex", "0");
        button.setAttribute("title", this.label);

        if (button.tagName === "BUTTON") {
            button.setAttribute("type", "button");
        }

        const svg = button.querySelector("svg") || this.createSvg();
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.innerHTML = '<path fill="currentColor" d="M 13.175373,22.074627 V 10.152985 l 3.69403,3.69403 c 0.335821,0.503731 1.175373,0.503731 1.511194,0.16791 0.503731,-0.335821 0.503731,-1.175373 0.16791,-1.511194 0,0 0,0 -0.16791,-0.16791 L 12.839552,6.6268657 c -0.503731,-0.5037314 -1.175373,-0.5037314 -1.511194,0 L 5.619403,12.335821 c -0.3358209,0.503731 -0.3358209,1.175373 0.1679104,1.511194 0.3358209,0.335821 1.0074627,0.335821 1.5111941,0 l 3.6940295,-3.69403 v 11.921642 c 0,0.671642 0.503732,1.175373 1.175373,1.175373 0.503732,-0.16791 1.007463,-0.503731 1.007463,-1.175373 z M 1.9253731,0.75 C 1.2537313,0.75 0.75,1.2537313 0.75,1.9253731 c 0,0.6716418 0.5037313,1.1753732 1.1753731,1.1753732 H 22.074627 C 22.746269,3.1007463 23.25,2.5970149 23.25,1.9253731 23.25,1.2537313 22.746269,0.75 22.074627,0.75 Z" />';

        if (!svg.parentElement) {
            button.appendChild(svg);
        }

        button.onclick = (event) => this.jumpToFirstMessage(event);
        button.oncontextmenu = (event) => this.jumpToFirstMessage(event);
        button.onkeydown = (event) => {
            if (event.key === "Enter" || event.key === " ") {
                this.jumpToFirstMessage(event);
            }
        };

        return button;
    }

    createSvg() {
        const namespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(namespace, "svg");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        return svg;
    }

    getTransitionTo() {
        if (typeof this.transitionTo === "function") return this.transitionTo;

        try {
            const candidate = BdApi?.Webpack?.getByStrings?.(
                ["transitionTo - Transitioning to"],
                {searchExports: true}
            );

            if (typeof candidate === "function") {
                this.transitionTo = candidate;
                return this.transitionTo;
            }
        }
        catch (error) {
            console.error("[JumpToTop] Failed to resolve Discord navigation helper.", error);
        }

        return null;
    }

    jumpToFirstMessage(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const route = this.getChannelRoute();
        if (!route) return;

        const target = `${route}/0`;
        const transitionTo = this.getTransitionTo();

        if (transitionTo) {
            transitionTo(target);
            return;
        }

        if (window.location.pathname === target) return;

        window.history.pushState({}, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
    }
};
