import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedBetween, working } from "./finished.ts";

function row(id: number, busy: boolean, parent?: number): SessionSummary {
    return {
        id,
        ...(parent === undefined ? {} : { parent }),
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

    void it("keeps a session working while a child or grandchild works", () => {
        const before = [row(1, true), row(2, false, 1), row(3, true, 2)];
        const idleParent = [row(1, false), row(2, false, 1), row(3, true, 2)];
        const allIdle = [row(1, false), row(2, false, 1), row(3, false, 2)];

        assert.deepEqual(ids(finishedBetween(before, idleParent, null)), []);
        assert.deepEqual(ids(finishedBetween(before, allIdle, null)), [1, 2, 3]);
        assert.deepEqual(ids(finishedBetween(idleParent, allIdle, null)), [1, 2, 3]);
    });
});

void describe("working", () => {
    void it("is the own run or any descendant, and ignores other trees", () => {
        const rows = [row(1, false), row(2, false, 1), row(3, true, 2), row(4, true)];

        assert.equal(working(row(1, false), rows), true);
        assert.equal(working(row(4, true), rows), true);
        assert.equal(working(row(2, false, 1), [row(1, true), row(2, false, 1)]), false);
    });

    void it("ends on a list that loops", () => {
        const loop = [row(1, false, 2), row(2, false, 1)];

        assert.equal(working(row(1, false, 2), loop), false);
    });
});
