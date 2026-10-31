import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blocksSince } from "../server/live-delta.ts";
import type { ClientBlock } from "../shared/protocol.ts";
import { START, withEvent } from "../web/src/lib/conversation-state.ts";

const text = (value: string): ClientBlock => ({ type: "text", text: value });
const thinking = (value: string): ClientBlock => ({ type: "thinking", text: value });
const call = (id: string): ClientBlock => ({ type: "toolCall", id, name: "bash", args: { id } });

/** What the server holds over time, one list per frame; `undefined` is the frame that ends a run. */
function screenAfter(frames: (ClientBlock[] | undefined)[]): (ClientBlock[] | undefined)[] {
    let held: ClientBlock[] = [];
    let state = START;
    const screens: (ClientBlock[] | undefined)[] = [];

    for (const blocks of frames) {
        const sent = blocks === undefined ? undefined : blocksSince(held, blocks);

        held = blocks ?? [];
        state = withEvent(state, {
            type: "live",
            session: 1,
            live: {
                busy: true,
                usage: { input: 0, output: 0, cost: 0 },
                ...(sent && { blocks: sent }),
            },
        });
        screens.push(state.live.blocks);
    }

    return screens;
}

void describe("a live frame cut to what a client holds", () => {
    void it("sends only the end of a block that grew", () => {
        const sent = blocksSince(
            [thinking("plan"), text("Hel")],
            [thinking("plan"), text("Hello")],
        );

        assert.deepEqual(sent, [
            { type: "thinking", text: "", from: 4 },
            { type: "text", text: "lo", from: 3 },
        ]);
    });

    void it("sends a block whole when it is not a continuation of what the client holds", () => {
        const sent = blocksSince([text("first try")], [text("second try")]);

        assert.deepEqual(sent, [text("second try")], "a retry rewrote it: replace, never append");
    });

    void it("gives the client exactly the server's blocks through growth, retry, new answer and end", () => {
        const frames = [
            [thinking("a")],
            [thinking("ab")],
            [thinking("abc"), call("c1")],
            [thinking("abc"), call("c1"), text("x")],
            // a retry rewrote the answer so far
            [thinking("abc"), call("c1"), text("y")],
            // a new generation: fewer blocks, and the first one is the same text again
            [thinking("abc")],
            [thinking("abc"), text("done")],
            // the type at a position changed
            [text("done")],
            undefined,
            [text("next run")],
        ];

        assert.deepEqual(screenAfter(frames), frames);
    });

    void describe("tool calls", () => {
        const write = (id: string, content: string): ClientBlock => ({
            type: "toolCall",
            id,
            name: "write",
            args: { path: "a.txt", content },
        });

        void it("leaves the arguments out of a call the client holds, and the client keeps them", () => {
            const frames = [
                [write("c1", "x".repeat(5000))],
                [write("c1", "x".repeat(5000)), text("hi")],
            ];
            const sent = blocksSince(frames[0] ?? [], frames[1] ?? []);

            assert.deepEqual(sent[0], { type: "toolCall", id: "c1", name: "write" });
            assert.deepEqual(screenAfter(frames), frames, "the screen still holds the whole call");
        });

        void it("sends changed arguments whole", () => {
            const frames = [
                [write("c1", "one")],
                [write("c1", "one two")],
                [write("c1", "one two")],
            ];
            const sent = blocksSince(frames[0] ?? [], frames[1] ?? []);

            assert.deepEqual(sent, [write("c1", "one two")]);
            assert.deepEqual(screenAfter(frames), frames);
        });

        void it("never lends the arguments of one call to another at the same position", () => {
            const first = [write("c1", "first file")];
            const second = [write("c2", "second file")];
            const sent = blocksSince(first, second);

            assert.deepEqual(sent, second, "a different id goes whole");
            assert.deepEqual(screenAfter([first, second]), [first, second]);
        });

        void it("sends a call whole when the client held another kind of block there", () => {
            const call1 = write("c1", "file");

            assert.deepEqual(blocksSince([text("a")], [call1]), [call1]);
            assert.deepEqual(blocksSince([], [call1]), [call1]);
        });

        void it("ends a round trip with arguments deep-equal to the server's", () => {
            const args = { path: "deep.txt", content: "l1\nl2", flags: [1, { a: null }] };
            const blocks: ClientBlock[] = [{ type: "toolCall", id: "c1", name: "write", args }];
            const [first, second, third] = screenAfter([blocks, blocks, [...blocks, text("go")]]);

            assert.deepEqual(first, blocks);
            assert.deepEqual(second, blocks);
            assert.deepEqual(third?.[0], blocks[0]);
        });
    });
});
