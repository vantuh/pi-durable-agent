import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEvent } from "../web/src/lib/event.ts";

void describe("parseEvent", () => {
    void it("keeps an answer's stats, a result's times and diff, and the stream's start", () => {
        const stats = {
            model: "m1",
            stopReason: "stop",
            input: 10,
            output: 2,
            cost: 0.1,
            startedAt: 1000,
            durationMs: 500,
        };
        const diff = "-1 a\n+1 b";
        const event = parseEvent(
            JSON.stringify({
                session: 1,
                type: "hello",
                model: "m1",
                entries: [
                    { id: 1, kind: "user", text: "hi", at: 900 },
                    { id: 2, kind: "assistant", blocks: [], stats },
                    {
                        id: 3,
                        kind: "toolResult",
                        callId: "c",
                        name: "edit",
                        text: "ok",
                        isError: false,
                        at: 1600,
                        durationMs: 3,
                        diff,
                    },
                ],
                live: { busy: true, usage: { input: 0, output: 0, cost: 0 }, startedAt: 2000 },
            }),
        );

        assert.ok(event?.type === "hello");
        assert.deepEqual(event.entries, [
            { id: 1, kind: "user", text: "hi", at: 900 },
            { id: 2, kind: "assistant", blocks: [], stats },
            {
                id: 3,
                kind: "toolResult",
                callId: "c",
                name: "edit",
                text: "ok",
                isError: false,
                at: 1600,
                durationMs: 3,
                diff,
            },
        ]);
        assert.equal(event.live.startedAt, 2000);
    });
});
