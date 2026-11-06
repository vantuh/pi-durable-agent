import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntryRecord } from "@earendil-works/pi-durable";

import { projectEntry } from "../server/projection.ts";
import { userTextOf } from "../server/user-entry.ts";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written entry, without the harness that brands its ids
const entry = (value: object): EntryRecord => value as unknown as EntryRecord;
const user = [{ role: "user", content: [{ type: "text", text: "from the message" }] }];

void describe("userTextOf", () => {
    const cases: [string, EntryRecord, string | undefined][] = [
        ["a person's message", entry({ id: 1, kind: "pi.user", model: user }), "from the message"],
        [
            "a message whose data carries the shown text",
            entry({ id: 1, kind: "chat.user", data: { text: "shown" }, model: user }),
            "shown",
        ],
        [
            "an application entry with an author",
            entry({ id: 1, kind: "x.report", data: { author: "Scout" }, model: user }),
            "from the message",
        ],
        [
            "an application entry without an author",
            entry({ id: 1, kind: "x.report", data: {}, model: user }),
            undefined,
        ],
        [
            "an application entry with an empty author",
            entry({ id: 1, kind: "x.report", data: { author: "" }, model: user }),
            undefined,
        ],
        [
            "an answer, even one that carries an author",
            entry({
                id: 1,
                kind: "pi.assistant",
                data: { author: "Scout" },
                model: [{ role: "user", content: "no" }],
            }),
            undefined,
        ],
    ];

    for (const [name, record, text] of cases) {
        void it(`reads ${name} as the transcript draws it`, () => {
            assert.equal(userTextOf(record), text);

            const projected = projectEntry(record);

            assert.equal(projected.kind === "user" ? projected.text : undefined, text);
        });
    }
});
