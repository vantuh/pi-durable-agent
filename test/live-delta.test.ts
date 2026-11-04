import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blocksSince, listSince } from "../server/live-delta.ts";
import type { ClientBlock, ClientQueued, ClientStatus } from "../shared/protocol.ts";
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

void describe("the queue of a live frame cut to what a client holds", () => {
    const steer = (id: number, body: string): ClientQueued => ({ id, mode: "steer", text: body });
    const big = steer(1, "x".repeat(2000));

    /** What one client sees after each server queue, as `sendLive` and `withEvent` do; `held` is what its hello gave it. */
    function queueScreens(
        queues: (ClientQueued[] | undefined)[],
        hello: ClientQueued[] = [],
    ): { screens: (ClientQueued[] | undefined)[]; sent: (ClientQueued[] | undefined)[] } {
        let held = hello;
        let state = withEvent(START, {
            type: "hello",
            session: 1,
            entries: [],
            live: {
                busy: true,
                usage: { input: 0, output: 0, cost: 0 },
                ...(hello.length > 0 && { queued: hello }),
            },
            model: "m",
            more: false,
        });
        const screens: (ClientQueued[] | undefined)[] = [];
        const sent: (ClientQueued[] | undefined)[] = [];

        for (const queue of queues) {
            const changed = listSince(held, queue);

            held = queue ?? [];
            sent.push(changed);
            state = withEvent(state, {
                type: "live",
                session: 1,
                live: {
                    busy: true,
                    usage: { input: 0, output: 0, cost: 0 },
                    ...(changed && { queued: changed }),
                },
            });
            screens.push(state.live.queued);
        }

        return { screens, sent };
    }

    void it("omits a queue the client holds, and the client keeps showing it", () => {
        const { screens, sent } = queueScreens([[big], [big], [big]]);

        assert.deepEqual(sent, [[big], undefined, undefined]);
        assert.deepEqual(screens, [[big], [big], [big]]);
    });

    void it("sends [] when the queue emptied, and the client clears it", () => {
        const { screens, sent } = queueScreens([[big], undefined, undefined]);

        assert.deepEqual(sent, [[big], [], undefined], "never omitted: the client would keep it");
        assert.deepEqual(screens, [[big], [], []]);
    });

    void it("treats an absent queue and [] as the same queue", () => {
        assert.equal(listSince([], undefined), undefined);
        assert.equal(listSince([], []), undefined);
    });

    void it("sends a replaced message whole", () => {
        const second = steer(1, "y".repeat(2000));
        const { screens, sent } = queueScreens([[big], [second], [second, steer(2, "z")]]);

        assert.deepEqual(sent, [[big], [second], [second, steer(2, "z")]]);
        assert.deepEqual(screens, sent);
    });

    void it("starts a client that joined with a queue from the queue its hello carried", () => {
        const { screens, sent } = queueScreens([[big], [big]], [big]);

        assert.deepEqual(sent, [undefined, undefined]);
        assert.deepEqual(screens, [[big], [big]]);
    });
});

void describe("the status of a live frame cut to what a client holds", () => {
    const field = (percent: string): ClientStatus => ({
        source: "cache-hit",
        slot: "composer",
        label: "cache",
        text: percent,
        title: `${percent} of the input came from the cache, ${"x".repeat(80)}`,
    });
    const cache = field("62%");

    /** What one client sees after each server status, as `sendLive` and `withEvent` do; `held` is what its hello gave it. */
    function statusScreens(
        statuses: (ClientStatus[] | undefined)[],
        hello: ClientStatus[] = [],
    ): { screens: (ClientStatus[] | undefined)[]; sent: (ClientStatus[] | undefined)[] } {
        let held = hello;
        let state = withEvent(START, {
            type: "hello",
            session: 1,
            entries: [],
            live: {
                busy: true,
                usage: { input: 0, output: 0, cost: 0 },
                ...(hello.length > 0 && { status: hello }),
            },
            model: "m",
            more: false,
        });
        const screens: (ClientStatus[] | undefined)[] = [];
        const sent: (ClientStatus[] | undefined)[] = [];

        for (const status of statuses) {
            const changed = listSince(held, status);

            held = status ?? [];
            sent.push(changed);
            state = withEvent(state, {
                type: "live",
                session: 1,
                live: {
                    busy: true,
                    usage: { input: 0, output: 0, cost: 0 },
                    ...(changed && { status: changed }),
                },
            });
            screens.push(state.live.status);
        }

        return { screens, sent };
    }

    void it("omits status the client holds, and the client keeps showing it", () => {
        const { screens, sent } = statusScreens([[cache], [cache], [cache]]);

        assert.deepEqual(sent, [[cache], undefined, undefined]);
        assert.deepEqual(screens, [[cache], [cache], [cache]]);
    });

    void it("sends [] when the status emptied, and the client clears it", () => {
        const { screens, sent } = statusScreens([[cache], undefined, undefined]);

        assert.deepEqual(sent, [[cache], [], undefined], "never omitted: the client would keep it");
        assert.deepEqual(screens, [[cache], [], []]);
    });

    void it("treats absent status and [] as the same status", () => {
        assert.equal(listSince([], undefined), undefined);
        assert.equal(listSince([], []), undefined);
    });

    void it("sends a changed field whole", () => {
        const next = field("71%");
        const { screens, sent } = statusScreens([[cache], [next], [next, field("9")]]);

        assert.deepEqual(sent, [[cache], [next], [next, field("9")]]);
        assert.deepEqual(screens, sent);
    });

    void it("starts a client that joined with status from the status its hello carried", () => {
        const { screens, sent } = statusScreens([[cache], [cache]], [cache]);

        assert.deepEqual(sent, [undefined, undefined]);
        assert.deepEqual(screens, [[cache], [cache]]);
    });
});
