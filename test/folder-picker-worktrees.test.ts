/**
 * The folder picker of a session that works in a linked worktree: it opens at the repository's own
 * checkout, its lists leave the worktrees out, and the worktrees are offered in one menu beside the
 * `New worktree` checkbox — one answer of the two, and the picked folder again once the folder moves.
 *
 * The app runs in a real browser: the picker, its menu and its requests are the ones the person uses.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createServer as createViteServer } from "vite";

import type { Chromium } from "../extensions/browser/lib/cdp.ts";
import { answer, readJson, writeEvent } from "../server/http.ts";
import { recordOf } from "../shared/guards.ts";
import type { SessionsEvent } from "../shared/protocol.ts";

const SESSION = 1;
const HOME = "/Users/vantuh";
/** The repository's own checkout: where the picker starts and what its lists offer. */
const MAIN = "/Users/vantuh/work/repository";
/** A linked worktree beside the repository, made by hand: the session works in this one. */
const ONE = "/Users/vantuh/work/feature-one";
const TWO = "/Users/vantuh/work/feature-two";
/** A folder of no repository: browsing it offers no worktrees at all. */
const PLAIN = "/Users/vantuh/work/plain";
/** A branch name as long as git takes, so the menu has to be cut to the screen rather than to its text. */
const LONG = `feature/${"long-worktree-label-".repeat(20)}`;
const THREE = "/Users/vantuh/work/feature-long";

/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;
/** Long enough to browse away from a folder and to press Open before its worktrees arrive. */
const PENDING_MS = 2000;

const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
const NEW_SESSION_SHOWN = `document.querySelector('button[aria-label="New session"]') !== null`;
const PICKER_SHOWN = `document.title !== "" && document.body.innerText.includes("pick a folder")`;
/** The picker's own dialog: the sidebar is a dialog too below `lg`, and it has menus of its own. */
const PICKER = `[...document.querySelectorAll('[role="dialog"]')].find((dialog) => dialog.innerText.includes("pick a folder"))`;
/** Every button the picker draws: its own rows, its lists and its footer. */
const PICKER_BUTTONS = `[...((${PICKER})?.querySelectorAll("button") ?? [])]`;
/** The menu's trigger: the folder the session would start in, and the worktrees on offer. */
const TRIGGER = `(${PICKER})?.querySelector('[aria-haspopup="menu"]') ?? null`;
const TRIGGER_TEXT = `(${TRIGGER})?.innerText.trim() ?? null`;
const OPEN_MENU = `(() => {
    const trigger = ${TRIGGER};

    if (trigger === null) {
        return false;
    }

    // The trigger opens on the press, not the release: that is the event it listens for.
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));

    return true;
})()`;
const MENU_ITEMS = `[...document.querySelectorAll('[role="menuitemradio"]')].map((item) => item.innerText.trim())`;
const CHOOSE = (name: string) => `(() => {
    const item = [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (each) => each.innerText.trim() === ${JSON.stringify(name)},
    );

    if (item === undefined) {
        return false;
    }

    item.click();

    return true;
})()`;
const BUTTONS = `(${PICKER_BUTTONS}).map((button) => (button.innerText || "").trim())`;
const CLICK = (text: string) => `(() => {
    const button = (${PICKER_BUTTONS})
        .filter((each) => each.innerText.trim() === ${JSON.stringify(text)})
        .at(-1);

    if (button === undefined) {
        return false;
    }

    button.click();

    return true;
})()`;
const NEW_WORKTREE = `document.getElementById("new-worktree")?.getAttribute("aria-checked") ?? null`;
const TICK_NEW_WORKTREE = `document.getElementById("new-worktree")?.click()`;
/** Whether the menu lies inside the window: a long name must not widen it past the screen. */
const MENU_FITS = `(() => {
    const content = document.querySelector('[data-slot="dropdown-menu-content"]');

    if (content === null) {
        return null;
    }

    const box = content.getBoundingClientRect();

    return box.left >= 0 && box.right <= innerWidth && box.width <= innerWidth;
})()`;
const OPEN_DISABLED = `(() => {
    const button = (${PICKER_BUTTONS}).find((each) => each.innerText.trim() === "Open");

    return button === undefined ? null : button.disabled;
})()`;

/** A list of words read out of the page: what Chromium hands back from `Runtime.evaluate` is untyped. */
function words(value: unknown): string[] {
    return Array.isArray(value) ? value.map((entry: unknown) => String(entry)) : [];
}

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
            cwd: ONE,
            // What the extension's `folderGroup` says: the repository this worktree belongs to.
            under: MAIN,
            model: "faux/m1",
            thinkingLevel: "off",
            busy: false,
            activeAt: Date.now(),
            unseen: false,
        },
    ],
};

/** The repository's checkouts, as `git worktree list` names them, read from a folder inside one of them. */
function worktreesAt(cwd: unknown): unknown[] {
    const rows = [
        { name: "main", path: MAIN, main: true },
        { name: "feature-one", path: ONE, main: false },
        { name: "feature-two", path: TWO, main: false },
        { name: LONG, path: THREE, main: false },
    ];

    return typeof cwd === "string" && rows.some((row) => row.path === cwd)
        ? rows.map((row) => ({ ...row, current: row.path === cwd }))
        : [];
}

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

/** What the app asked and what it said, read while it runs. */
type Asked = {
    /** Every folder the picker's list asked for. */
    folders: string[];
    /** Every list of folders `git-worktree` was asked to sift. */
    sifted: string[][];
    /** The folder each new session was started in. */
    created: string[];
    /** Every list of favourites the app saved. */
    saved: string[][];
};

/** The app the person uses, served from its sources over a server that answers for `git-worktree`. */
async function withApp(
    chromium: Browser,
    executable: string,
    when: (read: (expression: string) => Promise<unknown>, asked: Asked) => Promise<void>,
): Promise<void> {
    const asked: Asked = { folders: [], sifted: [], created: [], saved: [] };
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const viteCache = await mkdtemp(join(tmpdir(), "worktrees-vite-"));
    const profile = await mkdtemp(join(tmpdir(), "worktrees-browser-"));
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
            answer(response, 200, { cwd: ONE, home: HOME, model: "faux/m1", session: SESSION });

            return;
        }

        if (url.pathname === "/api/extensions") {
            answer(response, 200, {
                extensions: [
                    {
                        name: "git-worktree",
                        title: "Git worktree",
                        description: "",
                        enabled: true,
                        installed: true,
                    },
                ],
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

        if (url.pathname === "/api/sessions" && request.method === "POST") {
            void (async () => {
                const cwd = recordOf(await readJson(request))?.["cwd"];

                asked.created.push(typeof cwd === "string" ? cwd : "");
                answer(response, 200, { session: SESSION + 1 });
            })();

            return;
        }

        if (url.pathname === "/api/favourites") {
            if (request.method === "PUT") {
                void (async () => {
                    const folders = recordOf(await readJson(request))?.["folders"];

                    asked.saved.push(
                        Array.isArray(folders)
                            ? folders.filter((entry): entry is string => typeof entry === "string")
                            : [],
                    );
                    answer(response, 200, { ok: true });
                })();

                return;
            }

            // A favourite the picker must leave out, and one it must keep.
            answer(response, 200, { folders: [ONE, PLAIN] });

            return;
        }

        if (url.pathname === "/api/fs") {
            const path = url.searchParams.get("path") ?? HOME;

            asked.folders.push(path);
            answer(response, 200, {
                path,
                parent: null,
                home: HOME,
                // The worktrees stand beside the repository, as `git worktree add ../<name>` makes them.
                dirs: [
                    { name: "feature-one", path: ONE },
                    { name: "feature-two", path: TWO },
                    { name: "plain", path: PLAIN },
                ],
            });

            return;
        }

        if (url.pathname === "/api/extensions/git-worktree/actions/worktrees") {
            void (async () => {
                const args = recordOf(recordOf(await readJson(request))?.["args"]);
                const cwd = args?.["cwd"];

                // The answer for a folder browsed to takes its time: the picker must not offer the
                // worktrees of the folder it came from while this one is still on its way.
                if (cwd !== MAIN) {
                    await delay(PENDING_MS, undefined, { ref: false });
                }

                answer(response, 200, { result: worktreesAt(cwd) });
            })();

            return;
        }

        if (url.pathname === "/api/extensions/git-worktree/actions/linked") {
            void (async () => {
                const args = recordOf(recordOf(await readJson(request))?.["args"]);
                const folders = args?.["folders"];
                const all = Array.isArray(folders)
                    ? folders.filter((entry): entry is string => typeof entry === "string")
                    : [];

                asked.sifted.push(all);
                answer(response, 200, {
                    result: all.filter((folder) => folder === ONE || folder === TWO),
                });
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

        await connection.send("Page.enable", {}, page);
        await connection.send(
            "Page.navigate",
            { url: `http://127.0.0.1:${String(address.port)}/?session=${String(SESSION)}` },
            page,
        );

        await when(read, asked);
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

/** The picker, open, over the app: the two clicks of the sidebar, then the folder list. */
async function openPicker(
    read: (expression: string) => Promise<unknown>,
    until: (expression: string, within: number) => Promise<boolean>,
): Promise<void> {
    assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");

    // The sidebar's own button: an icon, so a name on it is an `aria-label` and nothing else.
    // Below `lg` the sidebar is a sheet that is mounted only while open, so open it first.
    await read(`document.querySelector('button[aria-label="Sessions"]')?.click()`);
    assert.equal(await until(NEW_SESSION_SHOWN, SHOWN_MS), true, "the sidebar is open");
    await read(`document.querySelector('button[aria-label="New session"]')?.click()`);
    assert.equal(await until(PICKER_SHOWN, SHOWN_MS), true, "the picker is open");
    assert.equal(
        await until(`(${TRIGGER_TEXT}) !== null`, SHOWN_MS),
        true,
        "git-worktree draws its option",
    );
}

void describe("the folder picker of a session in a worktree", () => {
    void it("opens at the repository, leaves worktrees out, and starts the session in the one chosen", async (t) => {
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

        await withApp(chromium, executable, async (read, asked) => {
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
            const untilAsked = async (check: (asked: Asked) => boolean): Promise<boolean> => {
                const end = Date.now() + SHOWN_MS;

                while (Date.now() < end) {
                    if (check(asked)) {
                        return true;
                    }

                    await delay(100);
                }

                return check(asked);
            };

            await openPicker(read, until);

            assert.equal(
                await untilAsked((seen) => seen.folders.length > 0),
                true,
                "the picker read a folder",
            );
            assert.deepEqual(
                asked.folders[0],
                dirname(MAIN),
                "it opens on the repository's own siblings, its row under the caret",
            );
            assert.equal(
                await until(
                    `document.activeElement?.getAttribute("data-folder") === ${JSON.stringify(MAIN)}`,
                    SHOWN_MS,
                ),
                true,
                "the current folder keeps its focused row even when the listing leaves it out",
            );
            assert.equal(
                await untilAsked((seen) => seen.sifted.length > 0),
                true,
                "the lists went to the extension to be sifted",
            );
            assert.equal(
                asked.folders.includes(ONE),
                false,
                "and never in the worktree the session works in",
            );

            const sifted = asked.sifted.at(0) ?? [];

            assert.deepEqual(
                [...sifted].sort(),
                [MAIN, ONE, TWO, PLAIN].sort(),
                "every list's folders go to the extension",
            );

            const texts = words(await read(BUTTONS));

            assert.equal(texts.includes("repository"), true, "the repository is offered");
            assert.equal(texts.includes("feature-one"), false, "a worktree is not, in any list");
            assert.equal(texts.includes("feature-two"), false);
            assert.equal(
                texts.filter((text) => text === "plain").length,
                2,
                "a folder of no repository stays where it was: a favourite, and a row to browse",
            );
            assert.deepEqual(
                asked.saved,
                [],
                "and no favourite is saved away behind the person's back",
            );

            assert.equal(
                await read(TRIGGER_TEXT),
                "Main checkout",
                "the folder as picked is offered",
            );
            assert.equal(await read(OPEN_MENU), true);
            assert.equal(
                await until(
                    `document.querySelectorAll('[role="menuitemradio"]').length === 4`,
                    SHOWN_MS,
                ),
                true,
                "the menu lists every checkout",
            );
            assert.deepEqual(await read(MENU_ITEMS), [
                "Main checkout",
                "feature-one",
                "feature-two",
                LONG,
            ]);
            assert.equal(await read(MENU_FITS), true, "and the longest name does not widen it");

            assert.equal(await read(CHOOSE("feature-one")), true);
            assert.equal(
                await until(
                    `document.querySelectorAll('[role="menuitemradio"]').length === 0`,
                    SHOWN_MS,
                ),
                true,
                "the menu closes on the answer",
            );
            assert.equal(await read(TRIGGER_TEXT), "feature-one", "the choice is the worktree");

            assert.equal(await read(CLICK("Open")), true);
            assert.equal(
                await untilAsked((seen) => seen.created.length > 0),
                true,
                "Open started a session",
            );
            assert.deepEqual(asked.created, [ONE], "in the worktree that was chosen");
        });
    });

    void it("takes a worktree or a new one, never both, and the picked folder again once it moves", async (t) => {
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

        await withApp(chromium, executable, async (read, asked) => {
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
            const untilAsked = async (check: (asked: Asked) => boolean): Promise<boolean> => {
                const end = Date.now() + SHOWN_MS;

                while (Date.now() < end) {
                    if (check(asked)) {
                        return true;
                    }

                    await delay(100);
                }

                return check(asked);
            };

            await openPicker(read, until);
            assert.equal(await read(NEW_WORKTREE), "false", "no new worktree to start with");
            assert.equal(await read(OPEN_MENU), true);
            assert.equal(
                await until(
                    `document.querySelectorAll('[role="menuitemradio"]').length === 4`,
                    SHOWN_MS,
                ),
                true,
                "the menu lists every checkout",
            );
            assert.equal(await read(MENU_FITS), true, "and the longest name does not widen it");
            assert.equal(await read(CHOOSE("feature-two")), true);
            assert.equal(await read(TRIGGER_TEXT), "feature-two");

            // Ticking the box is the other answer: the worktree chosen is not.
            await read(TICK_NEW_WORKTREE);
            assert.equal(await read(NEW_WORKTREE), "true");
            assert.equal(
                await read(TRIGGER_TEXT),
                "Main checkout",
                "a new worktree is off the folder",
            );
            assert.equal(await read(OPEN_DISABLED), true, "and asks for its name first");

            await read(TICK_NEW_WORKTREE);
            assert.equal(await read(OPEN_DISABLED), false, "unticked, Open goes ahead again");

            // Browsing away drops the choice, and coming back does not bring it back: a choice belongs
            // to the visit to the folder it was made for, not to the folder's name.
            assert.equal(await read(OPEN_MENU), true);
            assert.equal(
                await until(
                    `document.querySelectorAll('[role="menuitemradio"]').length === 4`,
                    SHOWN_MS,
                ),
                true,
                "the menu lists every checkout",
            );
            assert.equal(await read(CHOOSE("feature-two")), true);
            assert.equal(await read(TRIGGER_TEXT), "feature-two");
            assert.equal(await read(CLICK("plain")), true);
            assert.equal(
                await untilAsked((seen) => seen.folders.includes(PLAIN)),
                true,
                "the picker read the folder chosen",
            );
            assert.equal(
                await until(`(${TRIGGER_TEXT}) === null`, SHOWN_MS),
                true,
                "a folder of no repository offers no worktrees",
            );

            assert.equal(await read(CLICK("repository")), true);
            assert.equal(
                await until(`(${TRIGGER_TEXT}) === "Main checkout"`, SHOWN_MS),
                true,
                "back at the repository, the picked folder is the answer again",
            );
            assert.equal(await read(OPEN_DISABLED), false);

            assert.equal(await read(CLICK("Open")), true);
            assert.equal(
                await untilAsked((seen) => seen.created.length > 0),
                true,
                "Open started a session",
            );
            assert.deepEqual(asked.created, [MAIN], "in the folder as picked, not the old choice");
        });
    });

    void it("cannot submit the worktrees of a folder for one browsed to before its answer", async (t) => {
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

        await withApp(chromium, executable, async (read, asked) => {
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
            const untilAsked = async (check: (asked: Asked) => boolean): Promise<boolean> => {
                const end = Date.now() + SHOWN_MS;

                while (Date.now() < end) {
                    if (check(asked)) {
                        return true;
                    }

                    await delay(100);
                }

                return check(asked);
            };

            await openPicker(read, until);

            assert.equal(await read(OPEN_MENU), true);
            assert.equal(
                await until(
                    `document.querySelectorAll('[role="menuitemradio"]').length === 4`,
                    SHOWN_MS,
                ),
                true,
                "the menu lists every checkout",
            );
            assert.equal(await read(CHOOSE("feature-two")), true);
            assert.equal(await read(TRIGGER_TEXT), "feature-two");

            // The folder browsed to answers late: what is on screen meanwhile is not its list.
            assert.equal(await read(CLICK("plain")), true);
            assert.equal(
                await untilAsked((seen) => seen.folders.includes(PLAIN)),
                true,
                "the picker read the folder chosen",
            );
            assert.equal(
                await read(`(${TRIGGER_TEXT}) === null`),
                true,
                "no worktrees are offered while the answer is on its way",
            );

            assert.equal(await read(CLICK("Open")), true);
            assert.equal(
                await untilAsked((seen) => seen.created.length > 0),
                true,
                "Open started a session",
            );
            assert.deepEqual(asked.created, [PLAIN], "in the folder that was picked");
        });
    });
});
