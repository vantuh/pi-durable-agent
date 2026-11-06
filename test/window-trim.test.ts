/**
 * The conversation view is a window: the newest 50 entries, growing with appends to 100, then trimmed back to 50.
 * A browser that holds the entries the window drops must be sent appends all the same, never the window as a
 * replacement, and must keep what it holds. A real server runs over a session seeded past the first window, a
 * client reads its event stream, and enough runs are made to pass the trim.
 */

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import type { ClientEntry, ServerEvent } from "../shared/protocol.ts";
import { START, withEvent } from "../web/src/lib/conversation-state.ts";
import { parseEvent, parseHistory } from "../web/src/lib/event.ts";
import { cleanUp, linkExtension, REPO, sandbox, startServer } from "./fixtures/server.ts";

/** The window's first size: a session seeded with more entries than this opens with `before` set. */
const WINDOW = 50;
/** Two entries a run, and one more written by the first: the window passes its maximum of 100 on the 26th. */
const SEEDED_TURNS = 30;
const RUNS = 26;
const RUN_MS = 10_000;

/** A conversation of `fx/m1` with `turns` questions and answers, written the way a run writes them. */
async function seed(dataDir: string, cwd: string, turns: number): Promise<number> {
    const harness = await Harness.open(
        await openNodeSqliteStorage(join(dataDir, "state.sqlite")),
        {
            models: await ModelRuntime.create(),
            registry: createRegistry(),
            env: () => new NodeExecutionEnv({ cwd }),
        },
        BACKGROUND_CONTEXT,
    );

    try {
        const conversation = await harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: { model: { provider: "fx", modelId: "m1" }, cwd },
            },
            BACKGROUND_CONTEXT,
        );

        await harness.commit(async (tx) => {
            for (let turn = 0; turn < turns; turn += 1) {
                await tx.appendEntry(conversation.id, {
                    kind: "pi.user",
                    data: { text: `seeded question ${String(turn)}` },
                });
                await tx.appendEntry(conversation.id, {
                    kind: "pi.assistant",
                    model: [fauxAssistantMessage(`seeded answer ${String(turn)}`)],
                });
            }
        }, BACKGROUND_CONTEXT);

        return Number(conversation.id);
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
    }
}

/** A real server over a session seeded with `turns` turns, with the faux model that answers "ok". */
async function seededServer(turns: number): Promise<{ base: string; session: number }> {
    const box = await sandbox("window-trim");
    const { cwd, dataDir } = box;

    await mkdir(dataDir, { recursive: true });
    await linkExtension(box, "fauxmodel", {
        "server.ts": join(REPO, "test", "fixtures", "faux-ok-model.ts"),
    });

    const session = await seed(dataDir, cwd, turns);
    const { base } = await startServer({ box, env: { MODEL: "fx/m1" } });

    return { base, session };
}

/** One conversation stream, every event in the order it arrived. */
function watch(base: string, session: number): { events: ServerEvent[]; stop: () => void } {
    const events: ServerEvent[] = [];
    const request = httpGet(`${base}/api/events?session=${String(session)}`);
    let buffered = "";

    request.on("response", (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
            const parts = (buffered + chunk).split("\n\n");

            buffered = parts.pop() ?? "";

            for (const part of parts) {
                const event = part.startsWith("data: ") ? parseEvent(part.slice(6)) : undefined;

                if (event !== undefined) {
                    events.push(event);
                }
            }
        });
    });
    request.on("error", () => undefined);

    return { events, stop: () => request.destroy() };
}

const screenOf = (events: readonly ServerEvent[]) => events.reduce(withEvent, START);

const answers = (entries: readonly ClientEntry[]): number =>
    entries.filter((entry) => entry.kind === "assistant").length;

async function until(what: string, ready: () => boolean): Promise<void> {
    for (const end = performance.now() + RUN_MS; performance.now() < end;) {
        if (ready()) {
            return;
        }

        await delay(20);
    }

    assert.fail(`${what} did not happen within ${String(RUN_MS)} ms`);
}

after(cleanUp);

void describe("a browser holding entries the view window has dropped", () => {
    void it("is sent appends past the trim, and keeps every entry it holds", async () => {
        const { base, session } = await seededServer(SEEDED_TURNS);
        const stream = watch(base, session);

        await until("the hello", () => stream.events.length > 0);

        const hello = stream.events[0];

        assert.equal(hello?.type, "hello");
        assert.equal(
            hello.type === "hello" ? hello.entries.length : 0,
            WINDOW,
            "the session opens on the window, not on its whole log",
        );

        const opening = screenOf(stream.events).entries;
        const opened = opening.map((entry) => entry.id);
        const answered = answers(opening);

        for (let run = 1; run <= RUNS; run += 1) {
            const response = await fetch(`${base}/api/messages`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ session, text: `run ${String(run)}` }),
            });

            assert.equal(response.ok, true, `run ${String(run)} was accepted`);
            await until(
                `answer ${String(run)}`,
                () => answers(screenOf(stream.events).entries) === answered + run,
            );
        }

        stream.stop();

        const appended = stream.events
            .slice(1)
            .flatMap((event) => (event.type === "entries" ? [event.entries] : []));
        const held = screenOf(stream.events).entries.map((entry) => entry.id);

        assert.ok(
            held.length > 2 * WINDOW,
            `${String(held.length)} entries went by, past the window's maximum of ${String(2 * WINDOW)}`,
        );
        assert.deepEqual(
            held.slice(0, WINDOW),
            opened,
            "and none of what it opened on was dropped",
        );
        assert.ok(
            held.every((id, at) => at === 0 || id > (held[at - 1] ?? 0)),
            "in the log's order, each entry once",
        );
        assert.ok(
            appended.every((entries) => entries.length <= 2),
            `every frame is an append, none the window: ${JSON.stringify(appended.map((entries) => entries.length))}`,
        );

        // The window trimmed to 50 on the way, and a browser that arrives now starts from it.
        const late = watch(base, session);

        await until("the late hello", () => late.events.length > 0);
        late.stop();

        const lateHello = late.events[0];

        assert.equal(lateHello?.type, "hello");

        const lateIds = screenOf(late.events).entries.map((entry) => entry.id);

        assert.ok(lateIds.length <= 2 * WINDOW, "a new client is sent the window");
        assert.ok(lateIds.length < held.length, "which is less than the log");
        assert.deepEqual(
            held.slice(-lateIds.length),
            lateIds,
            "and the end of what the first client holds",
        );
        assert.equal(
            lateHello?.type === "hello" && lateHello.more,
            true,
            "with older entries to page",
        );

        const first = lateIds[0];
        const response = await fetch(
            `${base}/api/history?session=${String(session)}&before=${String(first)}`,
        );
        const page = parseHistory(await response.json());

        assert.ok(
            page !== undefined && page.entries.length > 0,
            "history pages back from the window",
        );
        assert.equal(
            page.entries.at(-1)?.id,
            held[held.length - lateIds.length - 1],
            "to the entry before it",
        );
    });
});
