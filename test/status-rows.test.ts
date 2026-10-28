import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { statusRows } from "../web/src/lib/status-rows.ts";

function session(id: number, extra: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title: null,
        cwd: null,
        model: null,
        thinkingLevel: null,
        busy: false,
        activeAt: id,
        unseen: false,
        ...extra,
    };
}

const ids = (rows: SessionSummary[]): number[] => rows.map((row) => row.id);
const never = (): boolean => false;

void describe("statusRows", () => {
    void it("lists working sessions, then unseen ones, each newest first, without the open one", () => {
        const rows = statusRows(
            [
                session(1, { busy: true }),
                session(2, { busy: true }),
                session(3, { unseen: true }),
                session(4, { unseen: true }),
                session(5, { busy: true }),
            ],
            5,
            never,
        );

        assert.deepEqual(ids(rows.working), [2, 1]);
        assert.deepEqual(ids(rows.unseen), [4, 3]);
        assert.deepEqual(rows.marked, []);
    });

    void it("lists an idle session that has a marker, apart from the working count", () => {
        const rows = statusRows(
            [session(1), session(2), session(3, { busy: true })],
            null,
            (s) => s.id === 1,
        );

        assert.deepEqual(ids(rows.marked), [1]);
        assert.deepEqual(ids(rows.working), [3]);
    });

    void it("lists a marked session once, even when it is unseen too", () => {
        const rows = statusRows([session(1, { unseen: true })], null, () => true);

        assert.deepEqual(ids(rows.marked), [1]);
        assert.deepEqual(rows.unseen, []);
    });

    void it("leaves out an archived session even with a marker", () => {
        const rows = statusRows([session(1, { archived: true })], null, () => true);

        assert.deepEqual(rows.marked, []);
    });

    void it("counts a working session started from another one with the one that started it", () => {
        const rows = statusRows(
            [
                session(1),
                session(2, { busy: true, parent: 1 }),
                session(3, { unseen: true, parent: 1 }),
            ],
            null,
            never,
        );

        assert.deepEqual(rows.working, []);
        assert.deepEqual(rows.unseen, []);
    });

    void it("keeps a session whose parent is gone, so nothing working goes unseen", () => {
        const rows = statusRows([session(2, { busy: true, parent: 9 })], null, never);

        assert.deepEqual(ids(rows.working), [2]);
    });
});
