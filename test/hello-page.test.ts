/**
 * Opening a session on a phone costs its newest page, not its whole history: the server answers in
 * milliseconds, so the `hello` of a session with hundreds of entries is the wait itself. The page is cut by
 * bytes, always keeps the newest entry, and says `more` when older entries were left out — which is the same
 * bit a compaction already sets, so the transcript reaches the start through `/api/history` as it always has.
 *
 * A real server runs on a disposable data directory, seeded through the harness so the entries are the ones
 * a run writes, and every frame is read with the browser's own parser.
 */

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import type { ClientHistory, ServerEvent } from "../shared/protocol.ts";
import { parseEvent, parseHistory } from "../web/src/lib/event.ts";
import { cleanUp, sandbox, startServer } from "./fixtures/server.ts";

/** Text of one entry: a question and its answer are about 6 KB together. */
const TEXT_BYTES = 3000;
/** Turns of the long session: about five times the newest page, and far past any budget of the phone's first screen. */
const TURNS = 60;
/** The first frame of a stream is written at once; a stream that held it would miss this. */
const FRAME_MS = 5000;

/** One conversation as it was seeded: its id, and every entry it holds, oldest first. */
type Seeded = { session: number; entries: number[] };

/** A conversation with `turns` questions and answers, seeded through the harness a run writes through. */
async function seed(dataDir: string, cwd: string, turns: number): Promise<Seeded> {
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
                agent: { model: { provider: "p", modelId: "m" }, cwd },
            },
            BACKGROUND_CONTEXT,
        );
        const entries = await harness.commit(async (tx) => {
            const ids: number[] = [];

            for (let turn = 0; turn < turns; turn += 1) {
                const question = await tx.appendEntry(conversation.id, {
                    kind: "pi.user",
                    data: { text: `question ${String(turn)} ${"q".repeat(TEXT_BYTES)}` },
                });
                const answer = await tx.appendEntry(conversation.id, {
                    kind: "pi.assistant",
                    model: [
                        fauxAssistantMessage(`answer ${String(turn)} ${"a".repeat(TEXT_BYTES)}`),
                    ],
                });

                ids.push(Number(question.id), Number(answer.id));
            }

            return ids;
        }, BACKGROUND_CONTEXT);

        return { session: Number(conversation.id), entries };
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
    }
}

/** A real server in a temporary folder over the seeded data, and the sessions it was given. */
async function seededServer(turns: readonly number[]): Promise<{ base: string; seeded: Seeded[] }> {
    const box = await sandbox("hello-page");
    const { cwd, dataDir } = box;

    await mkdir(dataDir, { recursive: true });

    const seeded: Seeded[] = [];

    for (const count of turns) {
        seeded.push(await seed(dataDir, cwd, count));
    }

    const { base } = await startServer({ box, env: { MODEL: "p/m" } });

    return { base, seeded };
}

/** The `hello` a conversation's stream starts with, read with the browser's parser and dropped at once. */
async function firstFrame(base: string, session: number): Promise<ServerEvent> {
    const abort = new AbortController();
    const deadline = setTimeout(() => {
        abort.abort(new Error(`no hello within ${String(FRAME_MS)} ms`));
    }, FRAME_MS);

    try {
        const response = await fetch(`${base}/api/events?session=${String(session)}`, {
            signal: abort.signal,
        });

        assert.equal(response.ok, true, "the stream opens");

        const reader = response.body?.getReader();

        assert.ok(reader !== undefined, "the stream has a body");

        const decoder = new TextDecoder();
        let buffered = "";

        for (;;) {
            const chunk = await reader.read();

            assert.notEqual(chunk.done, true, "the stream ended before a frame");

            buffered += decoder.decode(chunk.value, { stream: true });

            const end = buffered.indexOf("\n\n");

            if (end < 0) {
                continue;
            }

            const event = parseEvent(buffered.slice("data: ".length, end));

            if (event === undefined) {
                assert.fail("the first frame is not an event the browser knows");
            }

            return event;
        }
    } finally {
        clearTimeout(deadline);
        abort.abort();
    }
}

/** A page of older entries, asked for the way the transcript asks for one. */
async function history(base: string, session: number, before: number): Promise<ClientHistory> {
    const response = await fetch(
        `${base}/api/history?session=${String(session)}&before=${String(before)}`,
    );
    const page = parseHistory(await response.json());

    assert.ok(page !== undefined, "the page parses as a page");

    return page;
}

after(cleanUp);

void describe("the hello that opens a session", () => {
    void it("carries the newest page of a long session, and history reaches the entries it left out", async () => {
        const { base, seeded } = await seededServer([TURNS]);
        const long = seeded[0];

        assert.ok(long !== undefined, "the long session was seeded");

        const hello = await firstFrame(base, long.session);

        if (hello.type !== "hello") {
            assert.fail(`the first frame is a hello, not ${hello.type}`);
        }

        assert.ok(hello.entries.length > 0, "the page carries entries");
        assert.ok(
            hello.entries.length < long.entries.length,
            `the hello carries ${String(hello.entries.length)} of the conversation's ${String(long.entries.length)} entries`,
        );
        assert.deepEqual(
            hello.entries.map((entry) => entry.id),
            long.entries.slice(-hello.entries.length),
            "the page is the newest entries, in order, and the newest is among them",
        );
        assert.equal(hello.more, true, "the entries left out are older history");

        const first = hello.entries[0]?.id;

        assert.ok(first !== undefined, "the page starts at an entry");

        const page = await history(base, long.session, first);

        assert.ok(
            page.entries.every((entry) => entry.id < first),
            "the older page is older than the page the stream carried",
        );
        assert.equal(
            page.entries.at(-1)?.id,
            first - 1,
            "the older page ends at the entry just before the hello's first one",
        );
        assert.equal(page.more, true, "the conversation starts further back still");
    });

    void it("carries every entry of a session that fits, and says there is nothing older", async () => {
        const { base, seeded } = await seededServer([2]);
        const short = seeded[0];

        assert.ok(short !== undefined, "the short session was seeded");

        const hello = await firstFrame(base, short.session);

        if (hello.type !== "hello") {
            assert.fail(`the first frame is a hello, not ${hello.type}`);
        }

        assert.deepEqual(
            hello.entries.map((entry) => entry.id),
            short.entries,
            "every entry arrives, as before",
        );
        assert.equal(hello.more, false, "the conversation starts at its first entry");
    });
});
