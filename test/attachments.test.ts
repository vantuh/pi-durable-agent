import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEvent } from "../web/src/lib/event.ts";
import { turnsOf } from "../web/src/lib/turns.ts";

void describe("chat attachments", () => {
    void it("keeps photo and file metadata through events and transcript turns", () => {
        const files = [
            { name: "photo.png", path: "/uploads/123-photo.png", size: 2048, image: true },
            { name: "notes.txt", path: "/uploads/123-notes.txt", size: 16, image: false },
        ];
        const event = parseEvent(
            JSON.stringify({
                session: 1,
                type: "hello",
                model: "test",
                entries: [{ id: 1, kind: "user", text: "", files }],
                live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
            }),
        );

        assert.ok(event?.type === "hello");
        assert.deepEqual(turnsOf(event.entries, event.live)[0]?.user?.files, files);
    });
});
