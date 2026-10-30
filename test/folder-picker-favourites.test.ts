/**
 * A star pressed before the stored favourites arrive must not save over them: the list it would write
 * holds only the folder just pressed, and every favourite kept on the server is gone with it.
 *
 * The app runs in a real browser: the picker and its requests are the ones the person uses.
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
import { answer, readJson, record, writeEvent } from "../server/http.ts";
import type { SessionsEvent } from "../shared/protocol.ts";

const SESSION = 1;
/** A folder of the last session: it is what the picker offers to star. */
const FOLDER = "/Users/vantuh/work/pick-me";
const KEPT = "/Users/vantuh/work/kept";
/** Longer than the person could take to find the star, short enough to keep the test quick. */
const STORED_MS = 1500;
/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;
/** A save is read out of its request a moment after it is sent: long enough for one to show up. */
const SETTLED_MS = 1500;

const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
const PICKER_SHOWN = `document.title !== "" && document.body.innerText.includes("pick a folder")`;
/** Presses the star of the last row that has one: the Recent folder, when there is one. */
const STAR = `(() => {
    const stars = [...document.querySelectorAll('button[title="Favourite"]')];
    const star = stars.at(-1);

    if (star === undefined) {
        return false;
    }

    star.click();

    return true;
})()`;

/** A record read by key: what Chromium hands back from `Runtime.evaluate` is untyped JSON. */
function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const SESSIONS: SessionsEvent = {
    type: "sessions",
    sessions: [
        {
            id: SESSION,
            archived: false,
            name: null,
            title: "a session",
            cwd: FOLDER,
            model: "faux/m1",
            thinkingLevel: "off",
            busy: false,
            activeAt: Date.now(),
            unseen: false,
        },
    ],
};

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
 * The app the person uses, served from its sources over a server whose favourites answer arrives late.
 */
async function withApp(
    chromium: Browser,
    executable: string,
    when: (read: (expression: string) => Promise<unknown>, saved: string[][]) => Promise<void>,
): Promise<void> {
    const saved: string[][] = [];
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const viteCache = await mkdtemp(join(tmpdir(), "favourites-vite-"));
    const profile = await mkdtemp(join(tmpdir(), "favourites-browser-"));
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
                cwd: FOLDER,
                home: "/Users/vantuh",
                model: "faux/m1",
                session: 1,
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
            writeEvent(
                response,
                `data: ${JSON.stringify({
                    type: "hello",
                    session: SESSION,
                    entries: [],
                    live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
                    model: "faux/m1",
                    more: false,
                })}\n\n`,
            );

            return;
        }

        if (url.pathname === "/api/favourites") {
            if (request.method === "PUT") {
                void (async () => {
                    const body = record(await readJson(request));
                    const folders = body?.["folders"];

                    saved.push(
                        Array.isArray(folders)
                            ? folders.filter((entry): entry is string => typeof entry === "string")
                            : [],
                    );
                    answer(response, 200, { ok: true });
                })();

                return;
            }

            // The stored list takes a moment to arrive: the star is pressed in that moment.
            setTimeout(() => {
                answer(response, 200, { folders: [KEPT] });
            }, STORED_MS);

            return;
        }

        if (url.pathname === "/api/folders") {
            answer(response, 200, {
                path: url.searchParams.get("path"),
                parent: null,
                home: FOLDER,
                dirs: [],
            });

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

        await when(read, saved);
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
    }
}

void describe("the folder picker", () => {
    void it("does not save a star pressed before the favourites arrive over the stored ones", async (t) => {
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

        await withApp(chromium, executable, async (read, saved) => {
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
            /**
             * Waits for a save the server took, then for a while after it: a save the defect made earlier
             * is read out of its request a moment late, and it must be counted before this answers.
             */
            const savesSoFar = async (within: number): Promise<string[][]> => {
                const end = Date.now() + within;

                while (saved.length === 0 && Date.now() < end) {
                    await delay(100);
                }

                await delay(SETTLED_MS);

                return saved;
            };

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");

            await read(
                `[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "New session")?.click()`,
            );

            assert.equal(await until(PICKER_SHOWN, SHOWN_MS), true, "the picker is open");

            // Before the stored list lands, which is the moment the defect needs.
            await read(STAR);
            await delay(STORED_MS + 500);

            assert.equal(
                await read(STAR),
                true,
                "once the list is here, the star is there to press",
            );
            assert.deepEqual(
                await savesSoFar(SHOWN_MS),
                [[KEPT, FOLDER]],
                "and it adds to the stored folders instead of replacing them",
            );
        });
    });
});
