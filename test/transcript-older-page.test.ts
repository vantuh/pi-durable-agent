/**
 * The transcript asks the server for its older pages. After a compaction the stream carries only the entries since
 * the newest marker, and when that tail is shorter than the transcript's box there is nothing to scroll: the page
 * must be asked for without a wheel or a scrollbar, or the start of the conversation is unreachable. Asking from the
 * layout effect means asking on every commit, so a failed answer must not become a burst of them.
 *
 * The app runs in a real browser: the store, the scroll area and the layout effect are the ones the person uses.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createServer as createViteServer } from "vite";

import { Chromium } from "../extensions/browser/lib/cdp.ts";
import { findBrowser } from "../extensions/browser/lib/discovery.ts";
import { hasOlder, historyPage } from "../server/history.ts";
import { answer, writeEvent } from "../server/http.ts";
import { projectEntry } from "../server/projection.ts";

const OLDEST = "older question 0";
/** Long enough for Vite to compile the app on the first request, short enough to fail a broken page. */
const LOAD_MS = 30_000;
/** The server is asked for the older page as the transcript settles: a second is already generous. */
const ASKED_MS = 5000;
/** A failed answer that is asked again on every commit arrives hundreds of times a second; one is the answer. */
const QUIET_MS = 1000;

/** The transcript's scrolling box, as the page sees it. */
const SCROLLER = `[...document.querySelectorAll("[data-radix-scroll-area-viewport]")]
    .find((box) => box.innerText.includes("newest question"))`;
const TAIL_SHOWN = `${SCROLLER} !== undefined`;
const CANNOT_SCROLL = `${SCROLLER}.scrollHeight <= ${SCROLLER}.clientHeight`;
const OLDER_SHOWN = `document.body.innerText.includes(${JSON.stringify(OLDEST)})`;

/** A record read by key: what Chromium hands back from `Runtime.evaluate` is untyped JSON. */
function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

type Seeded = {
    dir: string;
    conversation: Conversation;
    close: () => Promise<void>;
};

async function withConversation(
    write: (conversation: Conversation) => Promise<void>,
): Promise<Seeded> {
    const dir = await mkdtemp(join(tmpdir(), "older-page-"));
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    const harness = await Harness.open(
        await openNodeSqliteStorage(join(dir, "state.sqlite")),
        { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
        BACKGROUND_CONTEXT,
    );
    const conversation = await harness.createConversation(
        {
            ownership: { kind: "ownerless" },
            agent: {
                model: { provider: faux.provider.id, modelId: faux.getModel().id },
                cwd: dir,
            },
        },
        BACKGROUND_CONTEXT,
    );

    await write(conversation);

    return {
        dir,
        conversation,
        close: async (): Promise<void> => {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        },
    };
}

/** A turn as the harness writes it: the question, the answer, its one tool's result. */
async function appendTurn(conversation: Conversation, ask: string): Promise<void> {
    await conversation.commit(async (tx) => {
        await tx.appendEntry(conversation.id, { kind: "pi.user", data: { text: ask } });
        await tx.appendEntry(conversation.id, { kind: "pi.assistant" });
        await tx.appendEntry(conversation.id, { kind: "pi.tool-result" });
    }, BACKGROUND_CONTEXT);
}

/** What a test can see of the app, once it is on screen in the browser. */
type Screen = {
    /** The entry the stream starts at: the one an older page is asked from. */
    marker: number;
    /** The `before` of every `/api/history` request, in the order the requests arrived. */
    asked: number[];
    /** Lets a held older page through; nothing to hold is already released. */
    release: () => void;
    seen: (expression: string) => Promise<boolean>;
    until: (expression: string, within: number) => Promise<boolean>;
};

/**
 * The app the person uses, served from its sources, over one conversation with a compaction and a short tail, and
 * opened in a real browser. Everything it needs, it asks for on its own; `when` looks at what it does.
 */
async function withApp(
    executable: string,
    options: {
        /** Every `/api/history` answer is a 500. */
        fails?: boolean;
        /** Hold the older page until the test releases it, so the tail alone can be measured. */
        hold?: boolean;
    },
    when: (screen: Screen) => Promise<void>,
): Promise<void> {
    const seeded = await withConversation(async (conversation) => {
        for (let turn = 0; turn < 6; turn += 1) {
            await appendTurn(conversation, `older question ${String(turn)}`);
        }
        // What a compaction leaves behind: a marker whose head is the start of the view, then one short turn.
        await conversation.commit(
            (tx) => tx.appendEntry(conversation.id, { kind: "pi.compaction", head: "self" }),
            BACKGROUND_CONTEXT,
        );
        await appendTurn(conversation, "newest question");
    });
    const session = Number(seeded.conversation.id);
    const asked: number[] = [];
    let release: () => void = () => undefined;
    const answerOlder = new Promise<void>((done) => {
        release = done;
    });

    if (options.hold !== true) {
        release();
    }

    const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
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
                model: "faux/m1",
                cwd: seeded.dir,
                home: seeded.dir,
                session,
            });

            return;
        }

        if (url.pathname === "/api/sessions/events") {
            response.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
            });
            writeEvent(
                response,
                `data: ${JSON.stringify({
                    type: "sessions",
                    sessions: [
                        {
                            id: session,
                            archived: false,
                            name: null,
                            title: "compacted session",
                            cwd: seeded.dir,
                            model: "faux/m1",
                            thinkingLevel: "off",
                            busy: false,
                            activeAt: Date.now(),
                            unseen: false,
                        },
                    ],
                })}\n\n`,
            );

            return;
        }

        if (url.pathname === "/api/events") {
            void (async () => {
                const view = await seeded.conversation.viewState(BACKGROUND_CONTEXT);
                const entries = view.value.entries.flatMap((record) => {
                    const entry = projectEntry(record);

                    return entry === undefined ? [] : [entry];
                });
                const first = entries[0];

                response.writeHead(200, {
                    "content-type": "text/event-stream",
                    "cache-control": "no-store",
                });
                writeEvent(
                    response,
                    `data: ${JSON.stringify({
                        type: "hello",
                        session,
                        entries,
                        live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
                        model: "faux/m1",
                        more:
                            first === undefined
                                ? false
                                : await hasOlder({
                                      conversation: seeded.conversation,
                                      context: BACKGROUND_CONTEXT,
                                      id: first.id,
                                  }),
                    })}\n\n`,
                );
            })();

            return;
        }

        if (url.pathname === "/api/history") {
            const before = Number(url.searchParams.get("before"));
            asked.push(before);

            if (options.fails === true) {
                answer(response, 500, { error: "the older entries are not here" });

                return;
            }

            void (async () => {
                await answerOlder;
                answer(
                    response,
                    200,
                    await historyPage({
                        conversation: seeded.conversation,
                        context: BACKGROUND_CONTEXT,
                        before,
                    }),
                );
            })();

            return;
        }

        // Everything else the shell asks for is not what this test is about: an empty answer keeps it quiet.
        answer(response, 200, {});
    });
    const profile = await mkdtemp(join(tmpdir(), "older-page-browser-"));
    let browser: Chromium | undefined;

    try {
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        const address = server.address();

        assert.ok(address !== null && typeof address === "object");

        browser = await Chromium.launch(executable, profile, []);
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
        const seen = async (expression: string): Promise<boolean> => {
            const value = await read(expression);

            return value === true;
        };
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
        const view = await seeded.conversation.viewState(BACKGROUND_CONTEXT);

        await connection.send("Page.enable", {}, page);
        await connection.send(
            "Page.navigate",
            { url: `http://127.0.0.1:${String(address.port)}/?session=${String(session)}` },
            page,
        );

        await when({
            marker: Number(view.value.entries[0]?.id),
            asked,
            release,
            seen,
            until,
        });
    } finally {
        if (browser !== undefined) {
            browser.kill();
            await browser.exited;
        }

        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await vite.close();
        await seeded.close();
        await rm(profile, { recursive: true, force: true });
    }
}

void describe("the transcript's older pages", () => {
    void it("asks for them when the view cannot scroll", async (t) => {
        const executable = findBrowser();

        if (executable === undefined) {
            t.skip("this machine has no Chromium to open the app in");

            return;
        }

        await withApp(executable, { hold: true }, async (screen) => {
            assert.equal(
                await screen.until(TAIL_SHOWN, LOAD_MS),
                true,
                "the stream's tail is on screen",
            );
            // The case the bug needs, measured while the older page is held: a box with nothing to scroll, so no
            // scroll event can ever be the thing that asks for what is above it.
            assert.equal(
                await screen.seen(CANNOT_SCROLL),
                true,
                "the tail is shorter than the transcript's box",
            );
            assert.equal(
                await screen.seen(OLDER_SHOWN),
                false,
                "the stream the compaction left carries nothing older than its marker",
            );

            const askedAt = Date.now() + ASKED_MS;

            while (screen.asked.length === 0 && Date.now() < askedAt) {
                await delay(50);
            }

            assert.deepEqual(
                screen.asked.slice(0, 1),
                [screen.marker],
                "the older page is asked for by itself, from the entry the stream starts at",
            );

            screen.release();

            assert.equal(
                await screen.until(OLDER_SHOWN, ASKED_MS),
                true,
                "the start of the conversation appears without a wave of the wheel",
            );

            await delay(500);
            assert.deepEqual(
                screen.asked,
                [screen.marker],
                "the page that ends the log is not asked for again",
            );
        });
    });

    // The ask moved into the layout effect, which runs on every commit: a failed answer changes the state, the state
    // changes the commit, and an unguarded effect asks again — a restart or a dropped connection would be a burst.
    void it("asks once for a page that never arrives", async (t) => {
        const executable = findBrowser();

        if (executable === undefined) {
            t.skip("this machine has no Chromium to open the app in");

            return;
        }

        await withApp(executable, { fails: true }, async (screen) => {
            assert.equal(
                await screen.until(TAIL_SHOWN, LOAD_MS),
                true,
                "the stream's tail is on screen",
            );
            assert.equal(
                await screen.seen(CANNOT_SCROLL),
                true,
                "the tail is shorter than the transcript's box, so nothing on screen can ask again",
            );

            await delay(QUIET_MS);

            assert.deepEqual(
                screen.asked,
                [screen.marker],
                "the failed page is asked for once, not on every commit it causes",
            );
        });
    });
});
