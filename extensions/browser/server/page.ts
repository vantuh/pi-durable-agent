/**
 * One conversation's page in the built-in browser: its events, screencast frames, console, and navigation, and what Pi
 * and people do to it.
 */
import type { BrowserState, LogEntry } from "../refs.ts";
import { BrowserError, type Connection, type Json } from "./cdp.ts";
import { parseKeys } from "./keys.ts";
import { LoadTracker } from "./load-tracker.ts";
import { captureScreenshot } from "./page-capture.ts";
import { evaluated, evaluateScript } from "./page-evaluate.ts";
import { clickAt, dispatchInput, pressKey } from "./page-input.ts";
import { formatArg, PageLog } from "./page-log.ts";
import {
    LOCATE_SCRIPT,
    SELECT_ALL_SCRIPT,
    SELECT_OPTION_SCRIPT,
    SNAPSHOT_SCRIPT,
} from "./page-scripts.ts";
import { type Frame, Screencast } from "./screencast.ts";
import type { Send } from "./send.ts";
import { clamp, presetOf, type Viewport } from "./viewport.ts";
import { wait } from "./wait.ts";

// The panel and the tools read the same state, so the wire types are declared once, for both sides.
export type { BrowserState, LogEntry };

/** Where Pi points: a ref from the last snapshot, a CSS selector, visible text, or a point. */
export type Target = { ref?: string; selector?: string; label?: string; x?: number; y?: number };

export type Saved = { url?: string; viewport?: Viewport };

/**
 * Across sites, a navigation moves the page to a new process, and for a moment Chromium refuses commands without running
 * them. These ones are sent again then, for up to `SWAP_WAIT_MS` (the last try still gets the command's own timeout):
 * reloading and stopping act on whatever document is there. Others are not: a script, a selection, or a place to click
 * meant for the old document must not act on the new one, and a navigation sent again could overtake a newer one.
 */
const RETRY_WHILE_SWAPPING = new Set(["Page.reload", "Page.stopLoading"]);
const SWAP_WAIT_MS = 3000;

function aborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new BrowserError("Stopped.");
    }
}

/** One conversation's page. Everything it knows comes from the browser's events; nothing here is stored. */
export class BrowserPage {
    readonly #connection: Connection;
    readonly #session: string;
    readonly #target: string;
    readonly #context: string;
    readonly #baseAgent: string;
    readonly #saved: (saved: Saved) => void;
    readonly #sender: Send = (method, params, timeoutMs) => this.#send(method, params, timeoutMs);
    readonly #loads = new LoadTracker();
    readonly #console = new PageLog();
    readonly #cast: Screencast;
    #frameId = "";
    #url = "about:blank";
    #title = "";
    #viewport: Viewport;
    #canGoBack = false;
    #canGoForward = false;
    #crashed = false;
    #closed = false;
    #historyTimer: NodeJS.Timeout | undefined;
    #saveTimer: NodeJS.Timeout | undefined;
    /** Last time Pi or a person used this page; idle pages close. */
    usedAt = Date.now();
    readonly #popups = new Map<string, NodeJS.Timeout>();
    /** Tabs already sent here or closed, until the browser says they are gone: their later updates change nothing. */
    readonly #handled = new Set<string>();

    constructor(options: {
        connection: Connection;
        session: string;
        target: string;
        context: string;
        userAgent: string;
        viewport: Viewport;
        saved: (saved: Saved) => void;
    }) {
        this.#connection = options.connection;
        this.#session = options.session;
        this.#target = options.target;
        this.#context = options.context;
        this.#baseAgent = options.userAgent;
        this.#viewport = options.viewport;
        this.#saved = options.saved;
        this.#cast = new Screencast({
            send: this.#sender,
            viewport: () => this.#viewport,
            closed: () => this.closed,
        });
        this.#connection.listen(this.#session, (method, params) => this.#event(method, params));
    }

    get targetId(): string {
        return this.#target;
    }

    get contextId(): string {
        return this.#context;
    }

    get closed(): boolean {
        return this.#closed || this.#connection.closed;
    }

    get url(): string {
        return this.#url;
    }

    get title(): string {
        return this.#title;
    }

    get viewport(): Viewport {
        return { ...this.#viewport };
    }

    /** Send a command to the page; a reload or stop again while a navigation swaps its document (`RETRY_WHILE_SWAPPING`). */
    async #send(
        method: string,
        params: Record<string, unknown> = {},
        timeoutMs?: number,
    ): Promise<Json> {
        const started = Date.now();

        for (;;) {
            if (this.#closed) {
                throw new BrowserError("This page is closed.");
            }

            try {
                return await this.#connection.send(method, params, this.#session, timeoutMs);
            } catch (error) {
                if (
                    !(error instanceof BrowserError) ||
                    error.message !== "Not attached to an active page" ||
                    !RETRY_WHILE_SWAPPING.has(method) ||
                    Date.now() - started > SWAP_WAIT_MS
                ) {
                    throw error;
                }

                await wait(25);
            }
        }
    }

    async init(): Promise<void> {
        await Promise.all([
            this.#send("Page.enable"),
            this.#send("Runtime.enable"),
            this.#send("Log.enable"),
        ]);
        const tree = await this.#send("Page.getFrameTree");

        this.#frameId = String(tree.frameTree?.frame?.id ?? "");
        await this.#applyViewport();
    }

    state(available: boolean): BrowserState {
        const preset = presetOf(this.#viewport);

        return {
            available,
            open: !this.closed,
            url: this.#url,
            title: this.#title,
            loading: this.#loads.loading,
            viewport: { ...this.#viewport },
            ...(preset === undefined ? {} : { preset }),
            canGoBack: this.#canGoBack,
            canGoForward: this.#canGoForward,
            errors: this.#console.errors,
            logs: this.#console.seq,
            ...(this.#crashed ? { problem: "The page crashed. Reload it." } : {}),
        };
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    #event(method: string, params: Json): void {
        switch (method) {
            case "Page.frameNavigated": {
                const frame = params.frame;

                if (frame === undefined || frame.parentId !== undefined) {
                    return;
                }

                this.#frameId = frame.id;
                // A page that failed to load shows Chromium's error page; the address is still the one asked for.
                this.#url = String(
                    frame.unreachableUrl ?? `${frame.url}${frame.urlFragment ?? ""}`,
                );
                this.#console.resetErrors();
                this.#crashed = false;
                this.#console.add("nav", this.#url);
                this.#navigated();

                return;
            }

            case "Page.navigatedWithinDocument":
                if (params.frameId !== this.#frameId) {
                    return;
                }

                this.#url = String(params.url);
                this.#navigated();

                return;
            case "Page.frameStartedLoading":
                if (params.frameId !== this.#frameId) {
                    return;
                }

                this.#loads.started();

                return;
            case "Page.frameStoppedLoading":
                if (params.frameId !== this.#frameId) {
                    return;
                }

                this.#loads.stopped();

                return;

            case "Page.javascriptDialogOpening": {
                // Nobody can answer a dialog in a headless page, and it would stop the page: accept it, and say so.
                this.#console.add("dialog", `${params.type}: ${params.message}`);
                void this.#send("Page.handleJavaScriptDialog", {
                    accept: true,
                    ...(params.type === "prompt"
                        ? { promptText: String(params.defaultPrompt ?? "") }
                        : {}),
                }).catch(() => {});

                return;
            }

            case "Page.screencastFrame":
                this.#cast.onFrame(params);

                return;

            case "Runtime.consoleAPICalled": {
                const level =
                    params.type === "warning"
                        ? "warn"
                        : params.type === "assert"
                          ? "error"
                          : String(params.type);

                if (level === "clear") {
                    return;
                }

                const frame = params.stackTrace?.callFrames?.[0];

                this.#console.add(
                    level,
                    (params.args ?? []).map(formatArg).join(" "),
                    frame === undefined ? undefined : `${frame.url}:${frame.lineNumber + 1}`,
                );

                return;
            }

            case "Runtime.exceptionThrown": {
                const details = params.exceptionDetails ?? {};
                const text =
                    String(
                        details.exception?.description ?? details.text ?? "Uncaught error",
                    ).split("\n    at ")[0] ?? "";

                this.#console.add(
                    "error",
                    text.startsWith("Uncaught") ? text : `Uncaught ${text}`,
                    details.url ? `${details.url}:${(details.lineNumber ?? 0) + 1}` : undefined,
                );

                return;
            }

            case "Log.entryAdded": {
                const entry = params.entry ?? {};

                // The browser asks every site for an icon by itself; most dev servers have none. Not the page's error.
                if (
                    entry.source === "network" &&
                    /\/favicon\.ico([?#]|$)/.test(String(entry.url ?? ""))
                ) {
                    return;
                }

                const level =
                    entry.level === "warning"
                        ? "warn"
                        : entry.level === "verbose"
                          ? "debug"
                          : String(entry.level ?? "info");

                this.#console.add(
                    level,
                    String(entry.text ?? ""),
                    entry.url ? String(entry.url) : undefined,
                );

                return;
            }

            case "Inspector.targetCrashed":
                this.#crashed = true;
                this.#loads.crashed();

                return;
        }
    }

    /** The browser's own events about this page's target, and popups it opened. */
    targetEvent(method: string, info: Json): void {
        if (info?.targetId === this.#target) {
            if (method === "Target.targetInfoChanged") {
                const title = String(info.title ?? "");
                // Until a page has a title, Chromium reports its address as one.
                const next =
                    title === info.url || title === this.#url.replace(/^https?:\/\//, "")
                        ? ""
                        : title;

                this.#title = next;
            }

            return;
        }

        const id = String(info?.targetId);

        // The browser says only which tab is gone.
        if (method === "Target.targetDestroyed") {
            clearTimeout(this.#popups.get(id));
            this.#popups.delete(id);
            this.#handled.delete(id);

            return;
        }

        if (info?.type !== "page" || info.browserContextId !== this.#context) {
            return;
        }

        // Pages the browser prerenders on a site's hint are its guesses, not tabs; and only this page's tabs come here.
        if (
            (info.subtype ?? "") !== "" ||
            (info.openerId !== undefined && info.openerId !== this.#target) ||
            this.#handled.has(id)
        ) {
            return;
        }

        // One page per conversation: a popup or new tab opens here instead, once it has an address.
        const url = String(info.url ?? "");

        if (method === "Target.targetCreated" || method === "Target.targetInfoChanged") {
            if (!this.#popups.has(id)) {
                const timer = setTimeout(() => this.#closePopup(id), 5000);

                timer.unref();
                this.#popups.set(id, timer);
            }

            if (url !== "" && url !== "about:blank") {
                this.#closePopup(id);
                // Opened from here, the address would skip the browser's own rules (a web page may not open a file): only
                // web addresses follow, and files from a page that is a file itself.
                const web =
                    /^https?:/i.test(url) || (/^file:/i.test(url) && /^file:/i.test(this.#url));

                if (web) {
                    void this.navigate(url, { wait: false }).catch(() => {});
                } else {
                    this.#console.add("warn", `A new tab for ${url} was not opened.`);
                }
            }
        }
    }

    #closePopup(targetId: string): void {
        clearTimeout(this.#popups.get(targetId));
        this.#popups.delete(targetId);
        this.#handled.add(targetId);
        void this.#connection.send("Target.closeTarget", { targetId }).catch(() => {});
    }

    #navigated(): void {
        clearTimeout(this.#historyTimer);
        this.#historyTimer = setTimeout(() => void this.#refreshHistory(), 50);
        this.#historyTimer.unref();
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => this.#save(), 1000);
        this.#saveTimer.unref();
    }

    #save(): void {
        if (this.#closed) {
            return;
        }

        const url = this.#url;

        this.#saved({
            ...(url === "about:blank" || url.startsWith("chrome-error:") ? {} : { url }),
            viewport: { ...this.#viewport },
        });
    }

    async #refreshHistory(): Promise<void> {
        try {
            const history = await this.#send("Page.getNavigationHistory");
            const back = history.currentIndex > 0;
            const forward = history.currentIndex < history.entries.length - 1;
            const entry = history.entries[history.currentIndex];
            // A page without a title has its address as one.
            const title =
                entry === undefined || entry.title === entry.url ? "" : String(entry.title ?? "");

            this.#canGoBack = back;
            this.#canGoForward = forward;
            this.#title = title;
        } catch {
            // Closed meanwhile.
        }
    }

    /** The newest frame after `after`, waiting for one up to 25 seconds; undefined if none came. */
    async frame(after: number, signal?: AbortSignal): Promise<Frame | undefined> {
        this.usedAt = Date.now();

        return await this.#cast.frame(after, signal);
    }

    /**
     * Taps, drags, scrolls, and keys from the Browser panel, in order: `click`, `mouse` (down, up, or move), `wheel`, `key`,
     * and `text`, at CSS pixels of the viewport. They come from browsers, so each is checked as it is read.
     */
    async input(events: readonly unknown[]): Promise<void> {
        this.usedAt = Date.now();

        await dispatchInput(this.#sender, this.#viewport, events);
    }

    // ─── Navigation ───────────────────────────────────────────────────────────

    /**
     * Open an address. With `wait`, until it has loaded (or `timeoutMs` passed); without, only as long as it takes to
     * hear whether it failed at once (nothing answers there), at most a few seconds. The result says how it went.
     */
    async navigate(
        url: string,
        options: { wait?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<{ error?: string; status?: number; slow?: boolean }> {
        this.usedAt = Date.now();
        const mark = this.#loads.mark();
        const budget = options.wait === false ? 3000 : (options.timeoutMs ?? 30_000);
        // The browser answers once the page starts to arrive: a server that never responds keeps it waiting, while the
        // navigation goes on.
        const answer = this.#send("Page.navigate", { url }, 120_000);

        answer.catch(() => {});
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<undefined>((done) => {
            timer = setTimeout(() => done(undefined), budget);
        });
        const result = await Promise.race([answer, late]).finally(() => clearTimeout(timer));

        if (result === undefined) {
            return options.wait === false ? {} : { slow: true };
        }

        if (result.errorText) {
            return { error: String(result.errorText) };
        }

        if (options.wait === false || result.loaderId === undefined) {
            return {};
        }

        const loaded = await this.#loads.settle(
            mark,
            options.timeoutMs ?? 30_000,
            options.signal,
            true,
        );

        aborted(options.signal);
        // Apps fetch their data after the load event; give them a moment.
        await wait(300);
        const status = await this.#send("Runtime.evaluate", {
            expression: `performance.getEntriesByType("navigation")[0]?.responseStatus ?? 0`,
            returnByValue: true,
        }).then(evaluated, () => 0);

        return {
            ...(typeof status === "number" && status > 0 ? { status } : {}),
            ...(loaded ? {} : { slow: true }),
        };
    }

    async go(
        delta: -1 | 1,
        options: { wait?: boolean; signal?: AbortSignal } = {},
    ): Promise<boolean> {
        this.usedAt = Date.now();
        const history = await this.#send("Page.getNavigationHistory");
        const entry = history.entries?.[history.currentIndex + delta];

        if (entry === undefined) {
            return false;
        }

        const mark = this.#loads.mark();

        await this.#send("Page.navigateToHistoryEntry", { entryId: entry.id });

        if (options.wait !== false) {
            await this.#loads.settle(mark, 30_000, options.signal);
        }

        return true;
    }

    async reload(options: { wait?: boolean; signal?: AbortSignal } = {}): Promise<void> {
        this.usedAt = Date.now();
        this.#crashed = false;
        const mark = this.#loads.mark();

        await this.#send("Page.reload", { ignoreCache: false });

        if (options.wait !== false) {
            await this.#loads.settle(mark, 30_000, options.signal, true);
        }
    }

    async stop(): Promise<void> {
        await this.#send("Page.stopLoading");
    }

    async #applyViewport(): Promise<void> {
        const viewport = this.#viewport;
        const agent = viewport.mobile
            ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${/Chrome\/([\d.]+)/.exec(this.#baseAgent)?.[1] ?? "130.0.0.0"} Mobile Safari/537.36`
            : this.#baseAgent;

        await Promise.all([
            this.#send("Emulation.setDeviceMetricsOverride", {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: viewport.scale,
                mobile: viewport.mobile,
            }),
            this.#send("Emulation.setTouchEmulationEnabled", {
                enabled: viewport.mobile,
                maxTouchPoints: viewport.mobile ? 5 : 1,
            }),
            agent === ""
                ? Promise.resolve()
                : this.#send("Emulation.setUserAgentOverride", { userAgent: agent }),
        ]);
    }

    async setViewport(viewport: Viewport): Promise<void> {
        this.usedAt = Date.now();
        this.#viewport = { ...viewport };
        await this.#applyViewport();

        await this.#cast.restart();

        this.#save();
    }

    // ─── What Pi does ─────────────────────────────────────────────────────────

    async #evaluate(expression: string, timeoutMs = 15_000): Promise<Json> {
        return evaluated(
            await this.#send(
                "Runtime.evaluate",
                { expression, returnByValue: true, awaitPromise: true, userGesture: true },
                timeoutMs,
            ),
        );
    }

    /** Where a target is on screen, scrolled into view. */
    async locate(target: Target): Promise<{
        x: number;
        y: number;
        label: string;
        covered?: string;
    }> {
        if (typeof target.x === "number" && typeof target.y === "number") {
            return {
                x: target.x,
                y: target.y,
                label: `the point ${Math.round(target.x)},${Math.round(target.y)}`,
            };
        }

        if (
            target.ref === undefined &&
            target.selector === undefined &&
            target.label === undefined
        ) {
            throw new BrowserError(
                "Say what to act on: a ref from the snapshot, a selector, a label, or x and y.",
            );
        }

        return await this.#evaluate(`(${LOCATE_SCRIPT})(${JSON.stringify(target)})`);
    }

    async click(
        target: Target,
        options: { count?: number; signal?: AbortSignal } = {},
    ): Promise<{ label: string; covered?: string; navigated: boolean }> {
        this.usedAt = Date.now();
        const found = await this.locate(target);
        const url = this.#url;
        const mark = this.#loads.mark();

        await clickAt(this.#sender, { x: found.x, y: found.y }, "left", options.count ?? 1);
        await this.#loads.settle(mark, 10_000, options.signal);

        return {
            label: found.label,
            ...(found.covered === undefined ? {} : { covered: found.covered }),
            navigated: this.#url !== url,
        };
    }

    async hover(target: Target): Promise<string> {
        this.usedAt = Date.now();
        const found = await this.locate(target);

        await this.#send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: found.x,
            y: found.y,
            button: "none",
        });
        await wait(150);

        return found.label;
    }

    /** Type into a target (clicking it first), or into what has focus. Replaces what the field holds unless `append`. */
    async type(
        target: Target | undefined,
        text: string,
        options: { append?: boolean; submit?: boolean; signal?: AbortSignal } = {},
    ): Promise<string> {
        this.usedAt = Date.now();
        let label = "the focused element";

        if (
            target !== undefined &&
            (target.ref ?? target.selector ?? target.label ?? target.x) !== undefined
        ) {
            const found = await this.locate(target);

            await clickAt(this.#sender, { x: found.x, y: found.y }, "left", 1);
            label = found.label;
        }

        if (options.append !== true) {
            const field = await this.#evaluate(SELECT_ALL_SCRIPT);

            // Some fields (email, number) cannot be selected by script: the editor's select-all works on them.
            if (field === "keys") {
                await pressKey(this.#sender, "a", 2);
            }

            if ((field === "selected" || field === "keys") && text === "") {
                await pressKey(this.#sender, "Backspace", 0);
            }
        }

        if (text !== "") {
            await this.#send("Input.insertText", { text });
        }

        if (options.submit === true) {
            const mark = this.#loads.mark();

            await pressKey(this.#sender, "Enter", 0);
            await this.#loads.settle(mark, 10_000, options.signal);
        }

        return label;
    }

    async press(combo: string, options: { signal?: AbortSignal } = {}): Promise<void> {
        this.usedAt = Date.now();
        const { key, modifiers } = parseKeys(combo);
        const mark = this.#loads.mark();

        await pressKey(this.#sender, key, modifiers);
        await this.#loads.settle(mark, 10_000, options.signal);
    }

    async select(target: Target, value: string): Promise<string> {
        this.usedAt = Date.now();

        return String(
            await this.#evaluate(
                `(${SELECT_OPTION_SCRIPT})(${JSON.stringify(target)}, ${JSON.stringify(value)})`,
            ),
        );
    }

    /** Scroll a target into view, or the page by `dy` pixels (a screen down by default). */
    async scroll(target: Target | undefined, dy?: number): Promise<string> {
        this.usedAt = Date.now();

        if (target !== undefined && (target.ref ?? target.selector ?? target.label) !== undefined) {
            return (await this.locate(target)).label;
        }

        const amount = dy ?? Math.round(this.#viewport.height * 0.8);

        await this.#send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: this.#viewport.width / 2,
            y: this.#viewport.height / 2,
            deltaX: 0,
            deltaY: amount,
        });
        await wait(250);

        return `${amount >= 0 ? "down" : "up"} ${Math.abs(amount)}px`;
    }

    async snapshot(): Promise<{
        lines: string;
        truncated: boolean;
        scrollY: number;
        scrollHeight: number;
        innerHeight: number;
    }> {
        this.usedAt = Date.now();

        return await this.#evaluate(SNAPSHOT_SCRIPT, 20_000);
    }

    /**
     * A JPEG of the viewport, or of the whole page (up to 8000 CSS pixels tall). The size it reports is in CSS pixels;
     * the image itself is at most `SHOT_MAX` pixels on its longer side, `scale` image pixels to a CSS pixel (1 unless
     * that made it smaller).
     */
    async screenshot(
        options: { fullPage?: boolean } = {},
    ): Promise<{ data: string; width: number; height: number; scale: number }> {
        this.usedAt = Date.now();

        return await captureScreenshot(this.#sender, this.#viewport, options);
    }

    /** Run JavaScript in the page: an expression or statements (top-level await works), or a body that uses `return`. */
    async evaluate(script: string, options: { timeoutMs?: number } = {}): Promise<string> {
        this.usedAt = Date.now();

        return await evaluateScript(this.#sender, script, options);
    }

    /** Wait for text or an element to show up, or a number of milliseconds. */
    async waitFor(options: {
        text?: string;
        selector?: string;
        ms?: number;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<boolean> {
        this.usedAt = Date.now();

        const { text } = options;

        if (text === undefined && options.selector === undefined) {
            await wait(clamp(options.ms ?? 1000, 0, 30_000));

            return true;
        }

        const check =
            options.selector !== undefined
                ? `(() => { const el = document.querySelector(${JSON.stringify(options.selector)}); return !!el && el.getClientRects().length > 0; })()`
                : `(document.body?.innerText ?? "").toLowerCase().includes(${JSON.stringify((text ?? "").toLowerCase())})`;
        const until = Date.now() + clamp(options.timeoutMs ?? 10_000, 0, 60_000);

        while (true) {
            aborted(options.signal);

            if ((await this.#evaluate(check).catch(() => false)) === true) {
                return true;
            }

            if (Date.now() >= until) {
                return false;
            }

            await wait(200);
        }
    }

    /** Console lines after `after` (all of them by default). */
    logs(after = 0): LogEntry[] {
        return this.#console.since(after);
    }

    get logSeq(): number {
        return this.#console.seq;
    }

    clearLogs(): void {
        this.#console.clear();
    }

    close(): void {
        if (this.#closed) {
            return;
        }

        this.#closed = true;
        this.#cast.close();
        clearTimeout(this.#historyTimer);
        clearTimeout(this.#saveTimer);

        for (const timer of this.#popups.values()) {
            clearTimeout(timer);
        }

        this.#loads.release();

        this.#connection.unlisten(this.#session);
    }
}
