import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEvent } from "../web/src/lib/event.ts";

void describe("parseEvent", () => {
    void it("drops anything that is not an event of a type this version knows", () => {
        for (const raw of [
            "",
            "not json",
            "null",
            "[]",
            JSON.stringify({ type: "hello" }),
            JSON.stringify({ session: "1", type: "hello" }),
            JSON.stringify({ session: 1, type: "invented-later" }),
        ]) {
            assert.equal(parseEvent(raw), undefined, raw);
        }
    });

    void it("hands a known event on untouched, tool diffs and answer stats included", () => {
        const event = {
            session: 1,
            type: "hello",
            model: "m1",
            entries: [
                { id: 1, kind: "user", text: "hi", at: 900 },
                {
                    id: 2,
                    kind: "assistant",
                    blocks: [{ type: "text", text: "there" }],
                    stats: {
                        model: "m1",
                        stopReason: "stop",
                        input: 10,
                        cached: 4,
                        output: 2,
                        cost: 0.1,
                        startedAt: 1000,
                        durationMs: 500,
                    },
                },
                {
                    id: 3,
                    kind: "toolResult",
                    callId: "c",
                    name: "edit",
                    text: "ok",
                    isError: false,
                    durationMs: 3,
                    diff: "-1 a\n+1 b",
                },
            ],
            live: { busy: true, usage: { input: 0, output: 0, cost: 0 } },
        };

        assert.deepEqual(parseEvent(JSON.stringify(event)), event);
    });
});
