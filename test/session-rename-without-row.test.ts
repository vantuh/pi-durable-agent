/**
 * Renaming the open session must reach it even when the sidebar draws no row for it: a session started
 * from another one has no row of its own, and a search or archive filter hides the rows it leaves out.
 * The rename form lives in the row, so the shell's rename key opens the same form in a dialog instead,
 * and the name it saves is the open session's, never the row-holding parent's. The dialog has no
 * trigger, so it has to give the focus back itself, and it stays the only form while it is open even
 * when the hidden row comes back.
 *
 * The app runs in a real browser: the keys, the dialog and the request are the ones the person uses.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createServer as createViteServer } from "vite";

import type { Chromium } from "../extensions/browser/lib/cdp.ts";
import { answer, readJson, writeEvent } from "../server/http.ts";
import { recordOf } from "../shared/guards.ts";
import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";

const FOLDER = "/Users/vantuh/work/rename-me";
/** The session the person started from. */
const PARENT = 1;
/** The session something started from it: the one the sidebar has no row for. */
const CHILD = 2;
/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;
/** A save is read out of its request a moment after it is sent: long enough for a second one to show. */
const SETTLED_MS = 500;

const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
/** No row at all: the child has none of its own, and a query that matches nothing hides the parent's. */
const NO_ROWS = `document.querySelectorAll(".session-row").length === 0`;
const ONE_ROW = `document.querySelectorAll(".session-row").length === 1`;
const DIALOG_SHOWN = `document.querySelector('[role="dialog"]')?.innerText.includes("Rename session") === true`;
/** The fallback took the focus, as a dialog does: its field is the first stop. */
const DIALOG_FOCUSED = `document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true`;
const NO_DIALOG = `document.querySelector('[role="dialog"]') === null`;
/** The box the rename key was pressed in: where the focus has to come back to. */
const SEARCH_FOCUSED = `document.activeElement === document.querySelector('input[aria-label="Search sessions"]')`;
/** One form, one `#rename-session`: the row must not open its own popover under the dialog. */
const RENAME_FORMS = `document.querySelectorAll("#rename-session").length`;
const RENAME_SURFACES = `document.querySelectorAll('[role="dialog"]').length`;

/** The prefix, then the key bound to `session.rename`, as a person presses them. */
const RENAME_KEY = [
    `window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true }))`,
    `window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR" }))`,
].join(",");

/** The search box, opened and given a query that matches neither session; it keeps the focus. */
const SEARCH = `(() => {
    const box = document.querySelector('input[aria-label="Search sessions"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    box.focus();
    set?.call(box, "nothing matches this");
    box.dispatchEvent(new Event("input", { bubbles: true }));

    return true;
})()`;

/** Presses the rename key and says whether the form is open: the key map arrives after the shell. */
const OPEN_RENAME = `(() => {
    ${RENAME_KEY};

    return ${DIALOG_SHOWN};
})()`;

/** Escape, as the dialog's own layer hears it. */
const ESCAPE = `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })), true`;

/** The way out of the form, by the label it draws. */
const cancel = (label: string): string => `(() => {
    const answer = [...document.querySelectorAll('[role="dialog"] button')].find(
        (button) => button.innerText.trim() === ${JSON.stringify(label)},
    );

    answer?.click();

    return answer !== undefined;
})()`;

/** Types a name into the form and submits it, as the person does. */
const renameTo = (name: string): string => `(() => {
    const field = document.querySelector("#rename-session");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    set?.call(field, ${JSON.stringify(name)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.form.requestSubmit();

    return true;
})()`;

/** A record read by key: what Chromium hands back from `Runtime.evaluate` is untyped JSON. */
function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const PARENT_ROW: SessionSummary = {
    id: PARENT,
    archived: false,
    name: null,
    title: "a parent",
    cwd: FOLDER,
    model: "faux/m1",
    thinkingLevel: "off",
    busy: false,
    activeAt: Date.now(),
    unseen: false,
};

const CHILD_ROW: SessionSummary = {
    ...PARENT_ROW,
    id: CHILD,
    title: "a child",
    parent: PARENT,
};

const SESSIONS: SessionsEvent = { type: "sessions", sessions: [PARENT_ROW, CHILD_ROW] };

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

/** What a test is handed once the app is on screen. */
type App = {
    read: (expression: string) => Promise<unknown>;
    /** Reads until the expression is true, or the wait runs out. */
    until: (expression: string, within: number) => Promise<boolean>;
    /** The session ids the shell asked the server to rename. */
    renamed: number[];
    /** Pushes a session-list frame, as a background change to a title does. */
    push: (rows: SessionSummary[]) => void;
};

/** The app the person uses, served from its sources over a server whose list holds a child session. */
async function withApp(
    chromium: Browser,
    executable: string,
    open: number,
    when: (app: App) => Promise<void>,
): Promise<void> {
    const renamed: number[] = [];
    let list: ServerResponse | undefined;
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const viteCache = await mkdtemp(join(tmpdir(), "rename-vite-"));
    const profile = await mkdtemp(join(tmpdir(), "rename-browser-"));
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
                session: open,
            });

            return;
        }

        if (url.pathname === "/api/sessions/events") {
            response.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
            });
            list = response;
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
                    session: open,
                    entries: [],
                    live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
                    model: "faux/m1",
                    more: false,
                })}\n\n`,
            );

            return;
        }

        if (url.pathname === "/api/sessions/title") {
            void (async () => {
                const body = recordOf(await readJson(request));
                const session = body?.["session"];

                if (typeof session === "number") {
                    renamed.push(session);
                }

                answer(response, 200, { ok: true });
            })();

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

        await connection.send("Page.enable", {}, page);
        // A desktop window: below `lg` the sidebar is a sheet, and a sheet that is closed holds no focusable box.
        await connection.send(
            "Emulation.setDeviceMetricsOverride",
            { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
            page,
        );
        await connection.send(
            "Page.navigate",
            { url: `http://127.0.0.1:${String(address.port)}/?session=${String(open)}` },
            page,
        );

        const push = (rows: SessionSummary[]): void => {
            assert.ok(list !== undefined, "the list stream is open");
            writeEvent(list, `data: ${JSON.stringify({ type: "rows", rows, gone: [] })}\n\n`);
        };

        await when({ read, until, renamed, push });
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

/** The app, or a skipped test: the two checks every case here needs before it can start. */
async function withRenameApp(
    t: { skip: (reason: string) => void },
    open: number,
    when: (app: App) => Promise<void>,
): Promise<void> {
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

    await withApp(chromium, executable, open, when);
}

/** The sidebar with a query that hides every row, and the focus left in the search box. */
async function hideRows({ read, until }: App): Promise<void> {
    await read(
        `[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Search sessions")?.click()`,
    );
    await read(SEARCH);

    assert.equal(await until(NO_ROWS, SHOWN_MS), true, "the query hides every row");
    assert.equal(await read(SEARCH_FOCUSED), true, "the search box holds the focus");
}

/** The ids renamed once a save has had a moment to land: a second request must be counted too. */
async function renamedSoFar(renamed: number[]): Promise<number[]> {
    const end = Date.now() + SHOWN_MS;

    while (renamed.length === 0 && Date.now() < end) {
        await delay(100);
    }

    await delay(SETTLED_MS);

    return renamed;
}

void describe("the rename key", () => {
    void it("renames the open session that has no row of its own", async (t) => {
        await withRenameApp(t, CHILD, async ({ read, until, renamed }) => {
            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            assert.equal(await until(ONE_ROW, SHOWN_MS), true, "the child session has no row");
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open");

            // The row's own form, in a dialog: the same field, and the answer goes to the open session.
            assert.equal(
                await read(`document.querySelector("#rename-session")?.placeholder`),
                "Leave empty for automatic name",
                "the rename form is the row's own",
            );

            await read(renameTo("renamed child"));

            assert.deepEqual(await renamedSoFar(renamed), [CHILD], "the open session was renamed");
        });
    });

    void it("renames the open session that a search hides", async (t) => {
        await withRenameApp(t, PARENT, async (app) => {
            const { read, until, renamed } = app;

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            await hideRows(app);
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open");

            await read(renameTo("renamed parent"));

            assert.deepEqual(await renamedSoFar(renamed), [PARENT], "the open session was renamed");
        });
    });

    void it("gives the focus back when the fallback closes", async (t) => {
        await withRenameApp(t, PARENT, async (app) => {
            const { read, until, renamed } = app;

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            await hideRows(app);

            // Escape.
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open");
            assert.equal(await read(DIALOG_FOCUSED), true, "the dialog takes the focus");
            await read(ESCAPE);
            assert.equal(await until(NO_DIALOG, SHOWN_MS), true, "Escape closes it");
            assert.equal(
                await until(SEARCH_FOCUSED, SHOWN_MS),
                true,
                "Escape gives the focus back",
            );

            // Cancel.
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open again");
            await read(cancel("Cancel"));
            assert.equal(await until(NO_DIALOG, SHOWN_MS), true, "Cancel closes it");
            assert.equal(
                await until(SEARCH_FOCUSED, SHOWN_MS),
                true,
                "Cancel gives the focus back",
            );

            // The save.
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open again");
            await read(renameTo("renamed parent"));
            assert.deepEqual(await renamedSoFar(renamed), [PARENT], "the open session was renamed");
            assert.equal(await until(NO_DIALOG, SHOWN_MS), true, "the save closes it");
            assert.equal(
                await until(SEARCH_FOCUSED, SHOWN_MS),
                true,
                "the save gives the focus back",
            );
        });
    });

    void it("keeps one rename form when the hidden row comes back", async (t) => {
        await withRenameApp(t, PARENT, async (app) => {
            const { read, until, renamed, push } = app;

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            await hideRows(app);
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open");

            // A background change to the title — an extension naming the session — makes the row match.
            push([{ ...PARENT_ROW, title: "nothing matches this" }]);

            assert.equal(await until(ONE_ROW, SHOWN_MS), true, "the row is back under the dialog");
            assert.equal(await read(RENAME_FORMS), 1, "one `#rename-session`");
            assert.equal(await read(RENAME_SURFACES), 1, "one rename surface");

            await read(renameTo("renamed parent"));

            assert.deepEqual(
                await renamedSoFar(renamed),
                [PARENT],
                "the open session was renamed once",
            );
        });
    });
});
