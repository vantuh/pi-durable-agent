// The app in a real Chromium, over a fake server that answers only what a test says. Tests call
// `findChromium` first (it skips the test when there is nothing to drive), then `withBrowserApp`.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Chromium } from "../../extensions/browser/server/cdp.ts";
import { listen } from "./serve.ts";
import { startVite } from "./vite.ts";

/** A record read by key: what Chromium hands back from `Runtime.evaluate` is untyped JSON. */
export function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** The Chromium the app is opened in, as the extension that owns it exposes it. */
type Browser = {
    launch: (executable: string, profile: string, extra: readonly string[]) => Promise<Chromium>;
    findBrowser: () => string | undefined;
};

export type Found = { browser: Browser; executable: string };

/**
 * Driving Chromium is an extension's job, so the core's tests cannot import it statically: a checkout without
 * `extensions/browser` would fail to run the file instead of skipping the test.
 */
async function loadBrowser(): Promise<Browser | undefined> {
    try {
        const [cdp, discovery] = await Promise.all([
            import("../../extensions/browser/server/cdp.ts"),
            import("../../extensions/browser/server/discovery.ts"),
        ]);

        return {
            launch: (executable, profile, extra) => cdp.Chromium.launch(executable, profile, extra),
            findBrowser: discovery.findBrowser,
        };
    } catch (error) {
        // Only an absent folder skips: a file that is there and broken must fail the test, not hide it.
        if (!(error instanceof Error) || Reflect.get(error, "code") !== "ERR_MODULE_NOT_FOUND") {
            throw error;
        }

        return undefined;
    }
}

/** The browser and where it is, or a skipped test: the two checks every browser case needs before it can start. */
export async function findChromium(t: {
    skip: (reason: string) => void;
}): Promise<Found | undefined> {
    const browser = await loadBrowser();

    if (browser === undefined) {
        t.skip("needs extensions/browser to drive Chromium");

        return undefined;
    }

    const executable = browser.findBrowser();

    if (executable === undefined) {
        t.skip("this machine has no Chromium to open the app in");

        return undefined;
    }

    return { browser, executable };
}

export type Page = {
    /** The address of the fake server, without a path. */
    base: string;
    /** Navigates the page: `path` is `/?session=1`, not a full address. */
    open: (path: string) => Promise<void>;
    /** A Chrome DevTools Protocol command to this page. */
    send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    read: (expression: string) => Promise<unknown>;
    seen: (expression: string) => Promise<boolean>;
    until: (expression: string, within: number) => Promise<boolean>;
};

/** Answers a request for `/api/...`; everything else is the app's own sources, served by Vite. */
export type ApiHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => void;

/**
 * The app the person uses, served from its sources over `api`. The page is blank until `run` opens one;
 * everything is closed and removed when `run` ends or throws.
 */
export async function withBrowserApp(
    found: Found,
    api: ApiHandler,
    run: (page: Page) => Promise<void>,
): Promise<void> {
    const profile = await mkdtemp(join(tmpdir(), "browser-test-"));
    const { vite, stop: stopVite } = await startVite("spa");
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");

        if (url.pathname.startsWith("/api/")) {
            api(request, response, url);

            return;
        }

        vite.middlewares(request, response, () => {
            response.writeHead(404).end();
        });
    });
    let browser: Chromium | undefined;
    let closeServer: (() => Promise<void>) | undefined;

    try {
        const { base, close } = await listen(server);

        closeServer = close;

        browser = await found.browser.launch(found.executable, profile, []);
        const connection = browser.connection;
        const opened = await connection.send("Target.createTarget", { url: "about:blank" });
        const attached = await connection.send("Target.attachToTarget", {
            targetId: opened.targetId,
            flatten: true,
        });
        const session = String(attached.sessionId);
        const send = async (method: string, params: Record<string, unknown>): Promise<unknown> =>
            await connection.send(method, params, session);
        const read = async (expression: string): Promise<unknown> =>
            field(
                field(
                    await send("Runtime.evaluate", {
                        expression,
                        returnByValue: true,
                        awaitPromise: true,
                    }),
                    "result",
                ),
                "value",
            );
        const seen = async (expression: string): Promise<boolean> =>
            (await read(expression)) === true;
        const until = async (expression: string, within: number): Promise<boolean> => {
            const end = Date.now() + within;

            while (Date.now() < end) {
                if (await seen(expression)) {
                    return true;
                }

                await delay(100);
            }

            return await seen(expression);
        };

        await send("Page.enable", {});
        await run({
            base,
            open: async (path) => {
                await send("Page.navigate", { url: `${base}${path}` });
            },
            send,
            read,
            seen,
            until,
        });
    } finally {
        if (browser !== undefined) {
            browser.kill();
            await browser.exited;
        }

        await closeServer?.();
        await stopVite();
        await rm(profile, { recursive: true, force: true });
    }
}
