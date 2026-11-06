/**
 * A star pressed before the stored favourites arrive must not save over them: the list it would write
 * holds only the folder just pressed, and every favourite kept on the server is gone with it.
 *
 * The app runs in a real browser: the picker and its requests are the ones the person uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { answer, readJson, writeEvent } from "../server/http.ts";
import { recordOf } from "../shared/guards.ts";
import type { SessionsEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import {
    findChromium,
    withBrowserApp,
    type ApiHandler,
    type Found,
    type Page,
} from "./fixtures/browser.ts";

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
const NEW_SESSION_SHOWN = `document.querySelector('button[aria-label="New session"]') !== null`;
const PICKER_SHOWN = `document.title !== "" && document.body.innerText.includes("pick a folder")`;
/** Presses the star of the last row that has one: the Recent folder, when there is one. */
const STAR = `(() => {
    const stars = [...document.querySelectorAll('button[aria-label="Favourite"]')];
    const star = stars.at(-1);

    if (star === undefined) {
        return false;
    }

    star.click();

    return true;
})()`;

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

/**
 * The app the person uses, served from its sources over a server whose favourites answer arrives late.
 */
async function withApp(
    found: Found,
    when: (page: Page, saved: string[][]) => Promise<void>,
): Promise<void> {
    const saved: string[][] = [];
    const api: ApiHandler = (request, response, url) => {
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
                    const body = recordOf(await readJson(request));
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
        answer(response, 200, defaultAnswer(url.pathname));
    };

    await withBrowserApp(found, api, async (page) => {
        await page.open(`/?session=${String(SESSION)}`);
        await when(page, saved);
    });
}

void describe("the folder picker", () => {
    void it("does not save a star pressed before the favourites arrive over the stored ones", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        await withApp(found, async ({ read, until }, saved) => {
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

            // The sidebar's own button: an icon, so a name on it is an `aria-label` and nothing else.
            // Below `lg` the sidebar is a sheet that is mounted only while open, so open it first.
            await read(`document.querySelector('button[aria-label="Sessions"]')?.click()`);
            assert.equal(await until(NEW_SESSION_SHOWN, SHOWN_MS), true, "the sidebar is open");
            await read(`document.querySelector('button[aria-label="New session"]')?.click()`);

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
