import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
    ClientBlock,
    ClientEntry,
    ClientLive,
    ClientQueued,
    ServerEvent,
} from "../shared/protocol.ts";
import { mergeEntries, START, withEvent, withOlder } from "../web/src/lib/conversation-state.ts";

const said = (id: number, text: string): ClientEntry => ({ id, kind: "user", text });

const entries = (ids: number[]): ServerEvent => ({
    type: "entries",
    session: 1,
    entries: ids.map((id) => said(id, `entry ${String(id)}`)),
});

const idsOf = (list: readonly ClientEntry[]): number[] => list.map((entry) => entry.id);

void describe("mergeEntries", () => {
    void it("keeps what was already read when a compaction shortens the view", () => {
        const loaded = [said(1, "first"), said(2, "second"), said(3, "third")];

        assert.deepEqual(
            idsOf(mergeEntries(loaded, [said(3, "third"), said(4, "fourth")])),
            [1, 2, 3, 4],
            "the start of the conversation stays, and the new entry is added",
        );
    });

    void it("holds one copy of an entry handed out twice, in the log's order", () => {
        const loaded = [said(5, "fifth"), said(7, "seventh")];

        assert.deepEqual(
            idsOf(mergeEntries(loaded, [said(7, "seventh"), said(5, "fifth"), said(4, "fourth")])),
            [4, 5, 7],
            "an id is one entry, and a marker written later does not push an older one below it",
        );
    });

    void it("hands back the list it was given when nothing came in", () => {
        const loaded = [said(1, "first")];

        assert.equal(mergeEntries(loaded, []), loaded);
    });
});

void describe("withEvent", () => {
    void it("does not take the loaded start away when the server rewrites the view", () => {
        const read = { ...START, session: 1, entries: [said(1, "first"), said(2, "second")] };

        // What a compaction sends: the whole active view, shorter than what the browser has.
        assert.deepEqual(idsOf(withEvent(read, entries([2, 3])).entries), [1, 2, 3]);
    });

    void it("starts a session's list over on hello, so another session's entries never show", () => {
        const read = { ...START, session: 7, entries: [said(9, "from session 7")] };
        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [said(1, "hallo")],
            live: START.live,
            model: "m1",
            more: false,
        };

        assert.deepEqual(idsOf(withEvent(read, hello).entries), [1]);
        assert.equal(withEvent(read, hello).session, 1);
    });

    void it("keeps the pages read before a reconnect, and that the start is already on screen", () => {
        const read = withOlder(
            { ...START, session: 1, entries: [said(9, "the tail")] },
            {
                entries: [said(1, "the start"), said(2, "second")],
                more: false,
            },
        );
        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [said(9, "the tail"), said(10, "just committed")],
            live: START.live,
            model: "m1",
            more: true,
        };

        const reconnected = withEvent(read, hello);

        assert.deepEqual(
            idsOf(reconnected.entries),
            [1, 2, 9, 10],
            "the same session's stream only carries the newest page, and the rest is still the conversation",
        );
        assert.equal(
            reconnected.exhausted,
            true,
            "the start is on screen, so a reconnect does not make it worth asking for again",
        );
    });

    void it("drops the last session's error on hello", () => {
        const read = {
            ...START,
            session: 7,
            entries: [said(9, "from session 7")],
            issue: "the older messages did not arrive",
        };

        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [],
            live: START.live,
            model: "m1",
            more: false,
        };

        assert.equal(withEvent(read, hello).issue, null);
    });

    void it("knows from hello whether the start is still to be asked for", () => {
        const hello = (more: boolean): ServerEvent => ({
            type: "hello",
            session: 1,
            entries: [said(9, "the tail")],
            live: START.live,
            model: "m1",
            more,
        });

        assert.equal(withEvent(START, hello(true)).exhausted, false, "older entries are still out");
        assert.equal(
            withEvent(START, hello(false)).exhausted,
            true,
            "the screen holds the whole conversation, so nothing is asked for",
        );
    });

    void describe("live blocks", () => {
        const frame = (blocks?: ClientBlock[]): ServerEvent => ({
            type: "live",
            session: 1,
            live: {
                busy: true,
                usage: { input: 0, output: 0, cost: 0 },
                ...(blocks && { blocks }),
            },
        });
        const held = (...blocks: ClientBlock[]) => withEvent(START, frame(blocks));
        const texts = (state: typeof START) =>
            (state.live.blocks ?? []).map((block) =>
                block.type === "toolCall" ? block.id : block.text,
            );

        void it("appends a tail to the text it holds at that position", () => {
            const state = withEvent(
                held({ type: "thinking", text: "plan" }, { type: "text", text: "Hel" }),
                frame([
                    { type: "thinking", text: "", from: 4 },
                    { type: "text", text: "lo, wor", from: 3 },
                ]),
            );

            assert.deepEqual(texts(state), ["plan", "Hello, wor"]);
            assert.equal(
                state.live.blocks?.some((block) => "from" in block),
                false,
                "what the screen holds is whole blocks",
            );
        });

        void it("replaces a block that starts over at from 0", () => {
            const state = withEvent(
                held({ type: "text", text: "first try" }),
                frame([{ type: "text", text: "second", from: 0 }]),
            );

            assert.deepEqual(texts(state), ["second"]);
        });

        void it("drops the blocks of the generation before when index 0 starts over", () => {
            const state = withEvent(
                held(
                    { type: "thinking", text: "old thought" },
                    { type: "toolCall", id: "c1", name: "bash", args: {} },
                    { type: "text", text: "old" },
                ),
                frame([{ type: "thinking", text: "new thought", from: 0 }]),
            );

            assert.deepEqual(texts(state), ["new thought"]);
        });

        void it("keeps the arguments it holds for a call the frame sends without them", () => {
            const args = { path: "a.txt", content: "kept" };
            const state = withEvent(
                held({ type: "toolCall", id: "c1", name: "write", args }),
                frame([
                    { type: "toolCall", id: "c1", name: "write" },
                    { type: "text", text: "next" },
                ]),
            );

            assert.deepEqual(state.live.blocks?.[0], {
                type: "toolCall",
                id: "c1",
                name: "write",
                args,
            });
        });

        void it("takes the arguments of a frame that carries them, even when it holds others", () => {
            const state = withEvent(
                held({ type: "toolCall", id: "c1", name: "write", args: { content: "old" } }),
                frame([{ type: "toolCall", id: "c1", name: "write", args: { content: "new" } }]),
            );

            assert.deepEqual(state.live.blocks?.[0], {
                type: "toolCall",
                id: "c1",
                name: "write",
                args: { content: "new" },
            });
        });

        void it("never gives one call the arguments of another", () => {
            const state = withEvent(
                held({ type: "toolCall", id: "c1", name: "write", args: { content: "mine" } }),
                frame([{ type: "toolCall", id: "c2", name: "write" }]),
            );
            const block = state.live.blocks?.[0];

            assert.ok(block?.type === "toolCall");
            assert.equal(block.id, "c2");
            assert.equal("args" in block, false, "c2 did not inherit c1's arguments");
        });

        void it("does not graft arguments onto a call where the screen held text", () => {
            const state = withEvent(
                held({ type: "text", text: "was text" }),
                frame([{ type: "toolCall", id: "c1", name: "write" }]),
            );

            assert.deepEqual(state.live.blocks, [{ type: "toolCall", id: "c1", name: "write" }]);
        });

        void it("clears the blocks when a frame has none, as the frame ending a run does", () => {
            const state = withEvent(held({ type: "text", text: "the answer so far" }), frame());

            assert.equal(state.live.blocks, undefined);
            assert.equal(state.live.busy, true, "the rest of the frame is taken as it is");
        });
    });

    void describe("live queued", () => {
        const queued: ClientQueued[] = [{ id: 1, mode: "steer", text: "wait" }];
        const frame = (extra: Partial<ClientLive>): ServerEvent => ({
            type: "live",
            session: 1,
            live: { busy: true, usage: { input: 0, output: 0, cost: 0 }, ...extra },
        });

        void it("keeps the queue it holds when a frame has no queued key", () => {
            const state = withEvent(withEvent(START, frame({ queued })), frame({}));

            assert.deepEqual(state.live.queued, queued);
        });

        void it("replaces the queue with the one a frame carries, and clears it on []", () => {
            const next: ClientQueued[] = [{ id: 2, mode: "followUp", text: "later" }];
            const held = withEvent(START, frame({ queued }));

            assert.deepEqual(withEvent(held, frame({ queued: next })).live.queued, next);
            assert.deepEqual(withEvent(held, frame({ queued: [] })).live.queued, []);
        });

        void it("keeps the queue of a hello through frames that omit it", () => {
            const state = withEvent(
                withEvent(START, {
                    type: "hello",
                    session: 1,
                    entries: [],
                    live: { busy: true, usage: { input: 0, output: 0, cost: 0 }, queued },
                    model: "m",
                    more: false,
                }),
                frame({ blocks: [{ type: "text", text: "a" }] }),
            );

            assert.deepEqual(state.live.queued, queued);
        });
    });
});
