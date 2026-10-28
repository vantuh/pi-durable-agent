import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { sessionsOf } from "../web/src/lib/api.ts";
import {
    holdingRow,
    isNested,
    sidebarSessions,
    workingChildren,
} from "../web/src/lib/session-nesting.ts";

function session(id: number, extra: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title: `Session ${String(id)}`,
        cwd: "/work",
        model: null,
        thinkingLevel: null,
        busy: false,
        activeAt: null,
        unseen: false,
        ...extra,
    };
}

const ids = (rows: SessionSummary[]): number[] => rows.map((row) => row.id);

void describe("sidebarSessions", () => {
    void it("leaves out a session whose parent is in the list", () => {
        const all = [session(1), session(2, { parent: 1 }), session(3)];

        assert.deepEqual(ids(sidebarSessions(all)), [1, 3]);
    });

    void it("keeps a session whose parent is not in the list", () => {
        const all = [session(2, { parent: 1 }), session(3)];

        assert.deepEqual(ids(sidebarSessions(all)), [2, 3]);
        assert.equal(isNested(session(2, { parent: 1 }), all), false);
    });

    void it("hides a child of an archived parent, because the list it is checked against is the full one", () => {
        const all = [session(1, { archived: true, cwd: "/other" }), session(2, { parent: 1 })];

        assert.deepEqual(ids(sidebarSessions(all)), [1]);
    });

    void it("hides every level of a chain", () => {
        const all = [session(1), session(2, { parent: 1 }), session(3, { parent: 2 })];

        assert.deepEqual(ids(sidebarSessions(all)), [1]);
    });
});

void describe("holdingRow", () => {
    const all = [session(1), session(2, { parent: 1 }), session(3, { parent: 2 }), session(4)];

    void it("is the parent of an open child", () => {
        assert.equal(holdingRow(2, all), 1);
    });

    void it("is the top row of an open grandchild", () => {
        assert.equal(holdingRow(3, all), 1);
    });

    void it("is null when the open session has its own row", () => {
        assert.equal(holdingRow(1, all), null);
        assert.equal(holdingRow(4, all), null);
        assert.equal(holdingRow(null, all), null);
    });

    void it("is null for a child whose parent is gone, which has its own row", () => {
        assert.equal(holdingRow(5, [session(5, { parent: 9 })]), null);
    });

    void it("ends on a loop instead of spinning", () => {
        assert.equal(holdingRow(1, [session(1, { parent: 2 }), session(2, { parent: 1 })]), null);
    });
});

void describe("sessionsOf", () => {
    void it("keeps the numeric parent the server sends and nothing else under that name", () => {
        const rows = sessionsOf({
            sessions: [{ id: 1 }, { id: 2, parent: 1 }, { id: 3, parent: "1" }],
        });

        assert.deepEqual(
            rows.map((row) => row.parent),
            [undefined, 1, undefined],
        );
    });

    void it("passes every field of a row through", () => {
        const sent = {
            id: 7,
            name: "n",
            title: "t",
            cwd: "/c",
            model: "p/m",
            thinkingLevel: "low",
            busy: true,
            mark: "x",
            archived: true,
            activeAt: 10,
            unseen: true,
            parent: 3,
            endedAt: 20,
        };

        assert.deepEqual(sessionsOf({ sessions: [sent] }), [sent]);
    });

    void it("keeps endedAt only as a number, and leaves it out otherwise", () => {
        const rows = sessionsOf({
            sessions: [{ id: 1 }, { id: 2, endedAt: 50 }, { id: 3, endedAt: "50" }],
        });

        assert.deepEqual(
            rows.map((row) => "endedAt" in row && row.endedAt),
            [false, 50, false],
        );
    });
});

void describe("workingChildren", () => {
    void it("counts only the working sessions that were started from this one", () => {
        const all = [
            session(1),
            session(2, { parent: 1, busy: true }),
            session(3, { parent: 1, busy: true }),
            session(4, { parent: 1 }),
            session(5, { parent: 9, busy: true }),
            session(6, { busy: true }),
        ];

        assert.equal(workingChildren(1, all), 2);
        assert.equal(workingChildren(9, all), 1);
        assert.equal(workingChildren(6, all), 0);
    });

    void it("counts a child of an archived or filtered-out row, as it reads the full list", () => {
        const all = [session(1, { archived: true }), session(2, { parent: 1, busy: true })];

        assert.equal(workingChildren(1, all), 1);
    });
});
