import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { finishedBetween } from "../web/src/lib/finished.ts";

function row(id: number, busy: boolean): SessionSummary {
    return {
        id,
        busy,
        archived: false,
        name: null,
        title: null,
        cwd: null,
        model: null,
        thinkingLevel: null,
        activeAt: null,
        unseen: !busy,
    };
}

const ids = (rows: SessionSummary[]): number[] => rows.map((session) => session.id);

void describe("finishedBetween", () => {
    void it("names only a run that ended, and not the session on screen", () => {
        const before = [row(1, true), row(2, true), row(3, false), row(4, true)];
        const after = [row(1, false), row(2, true), row(3, false), row(4, false), row(5, false)];

        assert.deepEqual(ids(finishedBetween(before, after, null)), [1, 4]);
        assert.deepEqual(ids(finishedBetween(before, after, 4)), [1]);
    });

    void it("names nothing on the first list, when no run was known to work", () => {
        assert.deepEqual(ids(finishedBetween([], [row(1, false)], null)), []);
    });
});
