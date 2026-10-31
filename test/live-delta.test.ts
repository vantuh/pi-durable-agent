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
});
