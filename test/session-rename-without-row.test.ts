/**
 * Renaming the open session must reach it even when the sidebar draws no row for it: a session started
 * from another one has no row of its own, and a search or archive filter hides the rows it leaves out.
 * The rename form lives in the row, so the shell's rename key opens the same form in a dialog instead,
 * and the name it saves is the open session's, never the row-holding parent's. The dialog has no
 * trigger, so it has to give the focus back itself, and it stays the only form while it is open even
 * when the hidden row comes back.
 *
 * The app runs in a real browser: the keys, the dialog and the request are the ones the person uses.
 *
 * The sidebar's collapse key runs here too, over the same fixture: it is a shell command bound by an
 * extension, and what it has to leave behind is the state the sidebar's own button saves.
 */

import assert from "node:assert/strict";
import { type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { answer, readJson, writeEvent } from "../server/http.ts";
import { recordOf } from "../shared/guards.ts";
import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import { findChromium, withBrowserApp, type ApiHandler, type Found } from "./fixtures/browser.ts";

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

/**
 * The prefix, then the key bound to `sidebar.toggle`, as a person presses them, and whether the state it
 * saves is `stored`. A press before the keymap arrives saves nothing, so waiting on this presses again.
 */
const toggleKey = (stored: string): string => `(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB" }));

    return localStorage.getItem("sidebarCollapsed") === ${JSON.stringify(stored)};
})()`;
const STORED_COLLAPSED = `localStorage.getItem("sidebarCollapsed")`;
/** The sidebar's own aside: the panel host is the other one, and it carries a slot name. */
const SIDEBAR = `document.querySelector('aside:not([data-slot="panel-host"])')`;
/** The rail is 37px and the open column 264, so the width says which one is on screen. */
const RAIL = `(${SIDEBAR})?.getBoundingClientRect().width < 100`;
const OPEN_SIDEBAR = `(${SIDEBAR})?.getBoundingClientRect().width > 200`;

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

/** The row's actions trigger, opened as a pointer opens it: the menu listens for the press. */
const ROW_ACTIONS = `document.querySelector('button[aria-label="Actions for a parent"]')`;
const ACTIONS_FOCUSED = `document.activeElement === (${ROW_ACTIONS})`;
const OPEN_ROW_ACTIONS = `(() => {
    const trigger = ${ROW_ACTIONS};

    trigger?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
    );

    return true;
})()`;
const pickRename = `[...document.querySelectorAll('[role="menuitem"]')].find((each) => each.innerText.trim() === "Rename")`;
const PICK_RENAME = `(() => {
    const item = ${pickRename};

    if (item === undefined) {
        return false;
    }

    item.click();

    return true;
})()`;
/** The same click, with the pointer moving on over that row while the menu it belongs to fades out. */
const PICK_RENAME_AND_MOVE = `(() => {
    const item = ${pickRename};

    if (item === undefined) {
        return false;
    }

    item.click();
    item.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));

    return true;
})()`;
const MENU_SHOWN = `document.querySelector('[role="menu"]') !== null`;
/** The row's rename form: a popover anchored to the row, not the fallback dialog. */
const POPOVER_SHOWN = `document.querySelector('[aria-label="Rename session"]') !== null`;
const POPOVER_FOCUSED = `document.activeElement === document.querySelector("#rename-session")`;
const RENAME_VALUE = `document.querySelector("#rename-session")?.value`;
/** A press somewhere else on the page: leaving the form with the mouse, not with the keyboard. */
const PRESS_ELSEWHERE = `(() => {
    const elsewhere = document.querySelector("textarea");

    for (const type of ["pointerdown", "pointerup"]) {
        elsewhere?.dispatchEvent(
            new PointerEvent(type, { bubbles: true, button: 0, pointerType: "mouse" }),
        );
    }

    elsewhere?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    return true;
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

/** What a test is handed once the app is on screen. */
type App = {
    read: (expression: string) => Promise<unknown>;
    /** Reads until the expression is true, or the wait runs out. */
    until: (expression: string, within: number) => Promise<boolean>;
    /** Opens the app again on the same profile, so what it saved is what it starts from. */
    reload: () => Promise<void>;
    /** The session ids the shell asked the server to rename. */
    renamed: number[];
    /** Pushes a session-list frame, as a background change to a title does. */
    push: (rows: SessionSummary[]) => void;
    /** Real typing into whatever holds the keyboard, with the input events a keyboard sends. */
    type: (text: string) => Promise<void>;
};

/** The app the person uses, served from its sources over a server whose list holds a child session. */
async function withApp(
    found: Found,
    open: number,
    when: (app: App) => Promise<void>,
): Promise<void> {
    const renamed: number[] = [];
    let list: ServerResponse | undefined;
    const api: ApiHandler = (request, response, url) => {
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
        answer(response, 200, defaultAnswer(url.pathname));
    };

    await withBrowserApp(found, api, async (page) => {
        // A desktop window: below `lg` the sidebar is a sheet, and a sheet that is closed holds no focusable box.
        await page.send("Emulation.setDeviceMetricsOverride", {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            mobile: false,
        });

        const url = `/?session=${String(open)}`;
        const reload = async (): Promise<void> => {
            await page.open(url);
        };

        await reload();

        const push = (rows: SessionSummary[]): void => {
            assert.ok(list !== undefined, "the list stream is open");
            writeEvent(list, `data: ${JSON.stringify({ type: "rows", rows, gone: [] })}\n\n`);
        };

        const type = async (text: string): Promise<void> => {
            await page.send("Input.insertText", { text });
        };

        await when({ read: page.read, until: page.until, reload, renamed, push, type });
    });
}

/** The app, or a skipped test: the two checks every case here needs before it can start. */
async function withSessionApp(
    t: { skip: (reason: string) => void },
    open: number,
    when: (app: App) => Promise<void>,
): Promise<void> {
    const found = await findChromium(t);

    if (found === undefined) {
        return;
    }

    await withApp(found, open, when);
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
        await withSessionApp(t, CHILD, async ({ read, until, renamed }) => {
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
        await withSessionApp(t, PARENT, async (app) => {
            const { read, until, renamed } = app;

            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            await hideRows(app);
            assert.equal(await until(OPEN_RENAME, SHOWN_MS), true, "the rename form is open");

            await read(renameTo("renamed parent"));

            assert.deepEqual(await renamedSoFar(renamed), [PARENT], "the open session was renamed");
        });
    });

    void it("gives the focus back when the fallback closes", async (t) => {
        await withSessionApp(t, PARENT, async (app) => {
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
        await withSessionApp(t, PARENT, async (app) => {
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

void describe("the row's actions menu", () => {
    void it("hands Rename to a form that keeps the caret", async (t) => {
        await withSessionApp(t, PARENT, async ({ read, until, type, renamed }) => {
            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            assert.equal(await until(ONE_ROW, SHOWN_MS), true, "the session has a row");

            const openMenu = async (): Promise<void> => {
                assert.equal(await read(OPEN_ROW_ACTIONS), true, "the row's actions open");
                assert.equal(await until(MENU_SHOWN, SHOWN_MS), true, "the menu is open");
            };
            const renameFromRow = async (): Promise<void> => {
                await openMenu();
                assert.equal(await read(PICK_RENAME), true, "the menu offers Rename");
                assert.equal(await until(POPOVER_SHOWN, SHOWN_MS), true, "the rename form is open");
            };

            // The hand goes on over the row it clicked while the menu fades: a form opened on the select loses
            // the caret to that row, one opened after the menu is gone takes it.
            await openMenu();
            assert.equal(await read(PICK_RENAME_AND_MOVE), true, "the menu offers Rename");
            assert.equal(await until(POPOVER_SHOWN, SHOWN_MS), true, "the rename form is open");
            assert.equal(
                await until(POPOVER_FOCUSED, SHOWN_MS),
                true,
                "the field has the caret as it appears",
            );
            await delay(SETTLED_MS);
            assert.equal(await read(POPOVER_SHOWN), true, "the form stays open");
            assert.equal(await read(POPOVER_FOCUSED), true, "and keeps the caret");
            await type("half a name");
            assert.equal(await read(RENAME_VALUE), "half a name", "the typing lands in the field");

            // Escape.
            await read(ESCAPE);
            assert.equal(await until(`!(${POPOVER_SHOWN})`, SHOWN_MS), true, "Escape closes it");
            assert.equal(
                await until(ACTIONS_FOCUSED, SHOWN_MS),
                true,
                "Escape gives the focus back",
            );

            // Cancel.
            await renameFromRow();
            await read(cancel("Cancel"));
            assert.equal(await until(`!(${POPOVER_SHOWN})`, SHOWN_MS), true, "Cancel closes it");
            assert.equal(
                await until(ACTIONS_FOCUSED, SHOWN_MS),
                true,
                "Cancel gives the focus back",
            );

            // A press elsewhere on the page, which is the person leaving the form rather than the keyboard.
            await renameFromRow();
            await read(PRESS_ELSEWHERE);
            assert.equal(
                await until(`!(${POPOVER_SHOWN})`, SHOWN_MS),
                true,
                "a press outside closes it",
            );

            // The save, which has to reach the row's own session.
            await renameFromRow();
            await read(renameTo("renamed parent"));
            assert.deepEqual(
                await renamedSoFar(renamed),
                [PARENT],
                "the row's session was renamed",
            );
            assert.equal(await until(`!(${POPOVER_SHOWN})`, SHOWN_MS), true, "the save closes it");
        });
    });
});

void describe("the sidebar's collapse key", () => {
    void it("folds the sidebar, saves that, and starts folded on the next visit", async (t) => {
        await withSessionApp(t, PARENT, async ({ read, until, reload }) => {
            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            assert.equal(await until(OPEN_SIDEBAR, SHOWN_MS), true, "the sidebar starts open");
            assert.equal(await read(STORED_COLLAPSED), null, "nothing is saved yet");

            assert.equal(await until(toggleKey("1"), SHOWN_MS), true, "the key saves it folded");
            assert.equal(await until(RAIL, SHOWN_MS), true, "and the sidebar is the rail");
            assert.equal(await read(STORED_COLLAPSED), "1", "the state is the button's own");

            assert.equal(await until(toggleKey("0"), SHOWN_MS), true, "the key saves it open");
            assert.equal(
                await until(OPEN_SIDEBAR, SHOWN_MS),
                true,
                "and the sidebar is open again",
            );

            assert.equal(await until(toggleKey("1"), SHOWN_MS), true, "folded again");
            assert.equal(await until(RAIL, SHOWN_MS), true, "the rail is back");

            await reload();
            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is back on screen");
            assert.equal(
                await until(RAIL, SHOWN_MS),
                true,
                "the sidebar starts the way the key left it",
            );
            assert.equal(await read(STORED_COLLAPSED), "1");
        });
    });
});
