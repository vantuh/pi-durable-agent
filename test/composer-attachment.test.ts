/**
 * A message the server refuses must not take the files with it. The words can be fetched back with the
 * up arrow; an uploaded file cannot be uploaded again by the browser, so the composer has to keep it.
 *
 * The app runs in a real browser: the composer, the store and the status bar are the ones the person uses.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createServer as createViteServer } from "vite";

import type { Chromium } from "../extensions/browser/lib/cdp.ts";
import { answer, writeEvent } from "../server/http.ts";
import type { ClientEntry, ServerEvent, SessionsEvent } from "../shared/protocol.ts";

const SESSION = 1;
const FILE = "a.txt";
const TEXT = "please keep this";
/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;

const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
const FILE_SHOWN = `document.body.innerText.includes(${JSON.stringify(FILE)})`;
/** The upload has landed: until it does, the composer refuses to send at all. */
const FILE_UPLOADED = `${FILE_SHOWN} && !document.body.innerText.includes("Uploading")`;
/** The status bar says what went wrong, so the send really reached a server that refuses messages. */
const REFUSED_SHOWN = `document.body.innerText.includes("the server refused the message")`;

/** A record read by key: what Chromium hands back from `Runtime.evaluate` is untyped JSON. */
function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function hello(): ServerEvent {
    const entries: ClientEntry[] = [];

    return {
        type: "hello",
        session: SESSION,
        entries,
        live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
        model: "faux/m1",
        more: false,
    };
}

const SESSIONS: SessionsEvent = {
    type: "sessions",
    sessions: [
        {
            id: SESSION,
            archived: false,
            name: null,
            title: "a session",
            cwd: null,
            model: "faux/m1",
            thinkingLevel: "off",
            busy: false,
            activeAt: Date.now(),
            unseen: false,
        },
    ],
};

/** Puts a file in the composer the way a paste does: the only way in that needs no file dialog. */
const PASTE = `(() => {
    const data = new DataTransfer();

    data.items.add(new File(["hello"], ${JSON.stringify(FILE)}, { type: "text/plain" }));
    document.querySelector("textarea").dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );

    return data.files.length;
})()`;

/** Types into the composer as React expects it: the native setter, then the event it listens for. */
const WRITE = `(() => {
    const area = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;

    setter.call(area, ${JSON.stringify(TEXT)});
    area.dispatchEvent(new Event("input", { bubbles: true }));

    return area.value;
})()`;

/** Enter sends, as it does for the person. */
const SEND = `(() => {
    const area = document.querySelector("textarea");

    area.focus();
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    return true;
})()`;

type Browser = {
    launch: (executable: string, profile: string, extra: readonly string[]) => Promise<Chromium>;
    findBrowser: () => string | undefined;
};

/**
 * Driving Chromium is an extension's job, so the core's tests cannot import it statically: a checkout without
 * `extensions/browser` would fail to run this file instead of skipping it.
 */
async function loadBrowser(): Promise<Browser | undefined> {
    try {
        const [cdp, discovery] = await Promise.all([
            import("../extensions/browser/lib/cdp.ts"),
            import("../extensions/browser/lib/discovery.ts"),
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

/**
 * The app the person uses, served from its sources over a server that takes uploads and refuses messages.
 */
async function withApp(
    chromium: Browser,
    executable: string,
    when: (read: (expression: string) => Promise<unknown>) => Promise<void>,
): Promise<void> {
    const uploads = await mkdtemp(join(tmpdir(), "composer-uploads-"));
    const sent: string[] = [];
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const viteCache = await mkdtemp(join(tmpdir(), "composer-vite-"));
    const profile = await mkdtemp(join(tmpdir(), "composer-browser-"));
    const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        cacheDir: viteCache,
        appType: "spa",
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");

        if (!url.pathname.startsWith("/api/")) {
            vite.middlewares(request, response, () => {
                response.writeHead(404).end();
            });

            return;
        }

        if (url.pathname === "/api/health") {
            answer(response, 200, {
                cwd: uploads,
                home: uploads,
                model: "faux/m1",
                session: SESSION,
            });

            return;
        }

        if (url.pathname === "/api/sessions/events") {
            response.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
            });
            writeEvent(response, `data: ${JSON.stringify(SESSIONS)}\n\n`);

            return;
        }

        if (url.pathname === "/api/events") {
            response.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
            });
            writeEvent(response, `data: ${JSON.stringify(hello())}\n\n`);

            return;
        }

        if (url.pathname === "/api/files") {
            const name = decodeURIComponent(request.headers["x-filename"]?.toString() ?? FILE);

            answer(response, 200, {
                path: join(uploads, `1-${name}`),
                name,
                size: 5,
                mime: "text/plain",
            });

            return;
        }

        if (url.pathname === "/api/messages") {
            sent.push("refused");
            // A refusal keeps the stub honest: the composer is what has to hold the file.
            answer(response, 400, { error: "the session is closed" });

            return;
        }

        // Everything else the shell asks for is not what this test is about: an empty answer keeps it quiet.
        answer(response, 200, {});
    });
    let browser: Chromium | undefined;

    try {
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        const address = server.address();

        assert.ok(address !== null && typeof address === "object");

        browser = await chromium.launch(executable, profile, []);
        const connection = browser.connection;
        const opened = await connection.send("Target.createTarget", { url: "about:blank" });
        const attached = await connection.send("Target.attachToTarget", {
            targetId: opened.targetId,
            flatten: true,
        });
        const page = String(attached.sessionId);
        const read = async (expression: string): Promise<unknown> => {
            const result = await connection.send(
                "Runtime.evaluate",
                { expression, returnByValue: true, awaitPromise: true },
                page,
            );

            return field(field(result, "result"), "value");
        };

        await connection.send("Page.enable", {}, page);
        await connection.send(
            "Page.navigate",
            { url: `http://127.0.0.1:${String(address.port)}/?session=${String(SESSION)}` },
            page,
        );

        await when(read);

        assert.deepEqual(sent, ["refused"], "one message was sent, and the server refused it");
    } finally {
        if (browser !== undefined) {
            browser.kill();
            await browser.exited;
        }

        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await vite.close();
        await rm(viteCache, { recursive: true, force: true });
        await rm(profile, { recursive: true, force: true });
        await rm(uploads, { recursive: true, force: true });
    }
}

void describe("a message the server refuses", () => {
    void it("keeps the files the person attached to it", async (t) => {
        const chromium = await loadBrowser();

        if (chromium === undefined) {
            t.skip("needs extensions/browser to drive Chromium");

            return;
        }

        const executable = chromium.findBrowser();

        if (executable === undefined) {
            t.skip("this machine has no Chromium to open the app in");

            return;
        }

        await withApp(chromium, executable, async (read) => {
            const until = async (expression: string, within: number): Promise<boolean> => {
                const end = Date.now() + within;

                while (Date.now() < end) {
                    if ((await read(expression)) === true) {
                        return true;
                    }

                    await delay(100);
                }

                return (await read(expression)) === true;
            };

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");

            assert.equal(await read(PASTE), 1, "the paste carried a file");
            assert.equal(
                await until(FILE_UPLOADED, SHOWN_MS),
                true,
                "the file waits in the composer",
            );

            assert.equal(await read(WRITE), TEXT);
            await read(SEND);

            assert.equal(
                await until(REFUSED_SHOWN, SHOWN_MS),
                true,
                "the server refused the message",
            );
            assert.equal(
                await until(FILE_SHOWN, SHOWN_MS),
                true,
                "the file is back in the composer, not lost with the message",
            );
        });
    });
});
