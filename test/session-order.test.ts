import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { newestFirst } from "../web/src/lib/session-order.ts";

function session(id: number, activeAt: number | null): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title: null,
        cwd: null,
        model: null,
        thinkingLevel: null,
        busy: false,
        activeAt,
        unseen: false,
    };
}

const ids = (rows: SessionSummary[]): number[] => rows.map((row) => row.id);

void describe("newestFirst", () => {
    void it("puts the latest activity first", () => {
        const rows = [session(1, 100), session(2, 300), session(3, 200)];

        assert.deepEqual(ids(rows.toSorted(newestFirst)), [2, 3, 1]);
    });

    void it("puts a session that was never worked in last, and keeps equal times in place", () => {
        const rows = [session(1, null), session(2, 100), session(3, 100)];

        assert.deepEqual(ids(rows.toSorted(newestFirst)), [2, 3, 1]);
    });
});
