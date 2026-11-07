/**
 * The sidebar groups sessions by folder: five to a folder, "more" opens the next page, a header folds its folder and
 * the fold, the name and the colour go to the server, so a phone and a computer show the same list.
 *
 * The app runs in a real browser: the headers and buttons are the ones the person presses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { answer, readJson, writeEvent } from "../server/http.ts";
import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import {
    findChromium,
    withBrowserApp,
    type ApiHandler,
    type Found,
    type Page,
} from "./fixtures/browser.ts";

const ALPHA = "/work/alpha";
const BETA = "/work/beta";
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;

const NOW = Date.now();
/** Seven sessions in alpha, the newest worked in first, and one in beta: alpha is the folder worked in last. */
const SESSIONS: SessionSummary[] = [
    ...Array.from({ length: 7 }, (_, index) => row(index + 1, ALPHA, NOW - index * 1000)),
    row(8, BETA, NOW - 60_000),
];

function row(id: number, cwd: string, activeAt: number): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title: `Session ${String(id)}`,
        cwd,
        model: "faux/m1",
        thinkingLevel: "off",
        busy: false,
        activeAt,
        unseen: false,
    };
}

/** What the server kept: beta is named and coloured, and nothing is folded. */
const STORED = {
    order: [BETA],
    collapsed: [],
    folders: { [BETA]: { name: "Beta app", color: "blue" } },
};

const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
/** The folder headers, top down, as the person reads them. */
const HEADERS = `[...document.querySelectorAll('section button[title^="/"]')].map((button) => button.textContent)`;
/** Sessions a person can reach: the rows a closed page or a folded folder keeps `inert` are not among them. */
const OPEN_ROWS = `[...document.querySelectorAll('nav a[href*="?session="]')].filter((link) => !link.closest("[inert]")).length`;
const PRESS = (text: string): string => `(() => {
    const button = [...document.querySelectorAll("section button")].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});

    button?.click();

    return button !== undefined;
})()`;

async function withApp(
    found: Found,
    when: (page: Page, saved: unknown[], created: unknown[]) => Promise<void>,
): Promise<void> {
    const saved: unknown[] = [];
    const created: unknown[] = [];
    const sessions: SessionsEvent = { type: "sessions", sessions: SESSIONS };
    const api: ApiHandler = (request, response, url) => {
        if (url.pathname === "/api/health") {
            answer(response, 200, {
                cwd: ALPHA,
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
            writeEvent(response, `data: ${JSON.stringify(sessions)}\n\n`);

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
                    session: 1,
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
                created.push(await readJson(request));
                answer(response, 201, { session: 99 });
            })();

            return;
        }

        if (url.pathname === "/api/folder-layout") {
            if (request.method === "PUT") {
                void (async () => {
                    saved.push(await readJson(request));
                    answer(response, 200, { ok: true });
                })();

                return;
            }

            answer(response, 200, STORED);

            return;
        }

        answer(response, 200, defaultAnswer(url.pathname));
    };

    await withBrowserApp(found, api, async (page) => {
        // Wide enough for the sidebar to be a column and not a sheet.
        await page.send("Emulation.setDeviceMetricsOverride", {
            width: 1280,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await page.open("/?session=1");
        await when(page, saved, created);
    });
}

void describe("the sidebar's folders", () => {
    void it("groups sessions by folder, pages them, folds them, and keeps the fold on the server", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        await withApp(found, async ({ read, until }, saved, created) => {
            assert.equal(await until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            assert.equal(
                await until(`${OPEN_ROWS} === 6`, SHOWN_MS),
                true,
                "five of alpha's seven sessions and beta's one are open",
            );

            const headers = await read(HEADERS);

            assert.ok(Array.isArray(headers));
            assert.match(String(headers[0]), /alpha/, "the folder not in the saved order is first");
            assert.match(String(headers[1]), /Beta app/, "beta shows the name it was given");

            assert.equal(await read(PRESS("2 more")), true, "alpha offers its other two");
            assert.equal(await until(`${OPEN_ROWS} === 8`, SHOWN_MS), true, "they open");

            assert.equal(
                await read(
                    `(() => {
                        const header = document.querySelector('section button[title^="/"]');

                        header?.click();

                        return header !== null;
                    })()`,
                ),
                true,
                "pressing the first header folds its folder",
            );
            assert.equal(await until(`${OPEN_ROWS} === 1`, SHOWN_MS), true, "only beta's is left");
            for (const end = Date.now() + SHOWN_MS; saved.length === 0 && Date.now() < end;) {
                await delay(50);
            }

            assert.deepEqual(saved.at(-1), { ...STORED, collapsed: [ALPHA] });

            // The menu of a folder starts a session in it: the top item, before rename and colour.
            await read(
                `document.querySelector('button[aria-label^="Actions for"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`,
            );
            assert.equal(
                await until(
                    `document.querySelector('[role="menuitem"]')?.textContent === "New session"`,
                    SHOWN_MS,
                ),
                true,
                "New session is the first item of the folder's menu",
            );
            await read(`document.querySelector('[role="menuitem"]')?.click()`);

            for (const end = Date.now() + SHOWN_MS; created.length === 0 && Date.now() < end;) {
                await delay(50);
            }

            assert.deepEqual(created, [{ cwd: ALPHA }]);
        });
    });
});
