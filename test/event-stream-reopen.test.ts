/**
 * A stream the browser gives up on has to be opened again. By the EventSource spec a non-200 answer — the proxy's 502
 * while the server restarts — closes the stream for good: readyState is CLOSED and no retry follows, so the transcript
 * and the session list freeze while the status bar still says "ready". The app has to open its own stream again, and
 * the reopened stream must not lose the history the screen already holds.
 *
 * The app runs in a real browser: the hooks, the store and the status bar are the ones the person uses.
 */

import assert from "node:assert/strict";
import { type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { answer, writeEvent } from "../server/http.ts";
import type { ClientEntry, ServerEvent, SessionsEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import { findChromium, withBrowserApp, type ApiHandler, type Found } from "./fixtures/browser.ts";

const SESSION = 1;
const FIRST = "the page the first stream carried";
const TAIL = "the entry only the reopened stream carries";
/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
/** A closed stream is reopened after a second, and a dropped one the browser retries itself after about three. */
const REOPEN_MS = 20_000;
/** The requests the schedule below allows: nothing is reopened twice, and a healthy stream is not opened again. */
const SETTLED_MS = 2000;

/** The stream a person's screen reads, and whether the status bar admits how it stands. */
const TRANSCRIPT_SHOWN = (text: string): string =>
    `document.body.innerText.includes(${JSON.stringify(text)})`;
const READY = TRANSCRIPT_SHOWN("ready");
/** The composer writes into a textarea: the shell is mounted, whatever its streams are doing. */
const SHELL_SHOWN = `document.querySelector("textarea") !== null`;
const FIRST_SHOWN = TRANSCRIPT_SHOWN(FIRST);
const TAIL_SHOWN = TRANSCRIPT_SHOWN(TAIL);

/** As much of the conversation as the stream carries: a message the person typed. */
function said(id: number, text: string): ClientEntry {
    return { id, kind: "user", text };
}

function hello(entries: ClientEntry[]): ServerEvent {
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
            title: "reopened session",
            cwd: null,
            model: "faux/m1",
            thinkingLevel: "off",
            busy: false,
            activeAt: Date.now(),
            unseen: false,
        },
    ],
};

/** What a test can see of the app, once it is on screen in the browser. */
type Screen = {
    /** How many times each stream was asked for, in the order the requests arrived. */
    asked: { events: number; sessions: number };
    /** Drops the conversation stream as it stands: what a restart of the server does to it. */
    drop: () => void;
    seen: (expression: string) => Promise<boolean>;
    until: (expression: string, within: number) => Promise<boolean>;
};

/** An answer a proxy gives while nothing listens behind it: the browser does not retry one. */
function restarting(response: ServerResponse): void {
    answer(response, 502, { error: "the server is restarting" });
}

function open(response: ServerResponse): void {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
}

/**
 * The app the person uses, served from its sources, over streams that answer like a server being restarted: a 502
 * while it is down, then the events of a live one. Everything it needs, it asks for on its own; `when` looks at what
 * it does.
 */
async function withApp(found: Found, when: (screen: Screen) => Promise<void>): Promise<void> {
    const asked = { events: 0, sessions: 0 };
    // Assigned by the answer the drop belongs to: the transcript's own schedule decides when the stream dies.
    let drop: () => void = () => undefined;

    const api: ApiHandler = (_request, response, url) => {
        if (url.pathname === "/api/health") {
            answer(response, 200, {
                model: "faux/m1",
                cwd: tmpdir(),
                home: tmpdir(),
                session: SESSION,
            });

            return;
        }

        if (url.pathname === "/api/sessions/events") {
            asked.sessions += 1;

            if (asked.sessions === 1) {
                restarting(response);

                return;
            }

            open(response);
            writeEvent(response, `data: ${JSON.stringify(SESSIONS)}\n\n`);

            return;
        }

        if (url.pathname === "/api/events") {
            asked.events += 1;

            // A server that is down when the browser asks, up when the app asks again, down once more when the
            // person restarts it under a stream that was open, and up for good after that.
            if (asked.events === 1 || asked.events === 3) {
                restarting(response);

                return;
            }

            open(response);
            writeEvent(
                response,
                `data: ${JSON.stringify(
                    hello(asked.events >= 4 ? [said(1, FIRST), said(2, TAIL)] : [said(1, FIRST)]),
                )}\n\n`,
            );

            if (asked.events === 2) {
                drop = () => {
                    response.destroy();
                };
            }

            return;
        }

        // Everything else the shell asks for is not what this test is about: an empty answer keeps it quiet.
        answer(response, 200, defaultAnswer(url.pathname));
    };

    await withBrowserApp(found, api, async (page) => {
        await page.open(`/?session=${String(SESSION)}`);
        await when({
            asked,
            drop: () => {
                drop();
            },
            seen: page.seen,
            until: page.until,
        });
    });
}

void describe("a stream the browser closed for good", () => {
    void it("is opened again, keeping the transcript it already had", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        await withApp(found, async (screen) => {
            assert.equal(await screen.until(SHELL_SHOWN, LOAD_MS), true, "the app is on screen");
            assert.equal(
                await screen.until(FIRST_SHOWN, REOPEN_MS),
                true,
                `the conversation's stream is opened again after the browser closed it (${JSON.stringify(screen.asked)})`,
            );
            assert.equal(
                await screen.until(READY, REOPEN_MS),
                true,
                `the session list's stream is opened again, so the status bar stops saying offline (${JSON.stringify(screen.asked)})`,
            );
            assert.deepEqual(
                screen.asked,
                { events: 2, sessions: 2 },
                "one more answer of each kind, and no stream opened twice",
            );

            // The person restarts the server: the stream they were reading dies, the retry meets the proxy's 502,
            // and only a stream the app opens itself can bring the transcript back.
            screen.drop();

            assert.equal(
                await screen.until(TAIL_SHOWN, REOPEN_MS),
                true,
                "the reopened stream's entries arrive after the restart",
            );
            assert.equal(
                await screen.seen(FIRST_SHOWN),
                true,
                "the page the dead stream carried is still the conversation",
            );
            assert.equal(
                screen.asked.events,
                4,
                "the drop was retried once, and the 502 answered once",
            );

            await delay(SETTLED_MS);

            assert.deepEqual(
                screen.asked,
                { events: 4, sessions: 2 },
                "an open stream is left alone: nothing is reopened on a healthy stream",
            );
        });
    });
});
