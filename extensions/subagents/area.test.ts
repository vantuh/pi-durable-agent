import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../../shared/protocol.ts";
import {
    age,
    agentsOf,
    areaParent,
    finishedAgo,
    hasWorkingAgent,
    workingAgentCount,
} from "./area.ts";

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

const ids = (rows: readonly SessionSummary[]): number[] => rows.map((row) => row.id);

void describe("areaParent", () => {
    const all = [session(1), session(2, { parent: 1 }), session(3, { parent: 99 }), session(4)];

    void it("is the open session itself, or for an agent the session that started it", () => {
        assert.equal(areaParent(1, all)?.id, 1);
        assert.equal(areaParent(2, all)?.id, 1);
        assert.equal(areaParent(4, all)?.id, 4);
    });

    void it("is nothing on the home page, for an unknown session, and for an agent whose parent is gone", () => {
        assert.equal(areaParent(null, all), undefined);
        assert.equal(areaParent(77, all), undefined);
        assert.equal(areaParent(3, all), undefined);
    });
});

void describe("agentsOf", () => {
    void it("lists only the parent's agents: working first, then finished ones, newest first", () => {
        const rows = agentsOf(1, [
            session(1),
            session(2, { parent: 1, activeAt: 900, endedAt: 500 }),
            session(3, { parent: 1, activeAt: 100, endedAt: 900 }),
            session(4, { parent: 1, activeAt: 100, busy: true }),
            session(5, { parent: 1, activeAt: 300, busy: true }),
            session(6, { parent: 7, busy: true }),
            session(7),
        ]);

        assert.deepEqual(ids(rows), [5, 4, 3, 2]);
    });

    void it("puts a finished agent whose end is unknown last, whatever its activeAt", () => {
        const rows = agentsOf(1, [
            session(2, { parent: 1, activeAt: 900 }),
            session(3, { parent: 1, activeAt: 300, endedAt: 100 }),
            session(4, { parent: 1, activeAt: 200, endedAt: 200 }),
        ]);

        assert.deepEqual(ids(rows), [4, 3, 2]);
    });

    void it("keeps a stable order for agents without a time", () => {
        const rows = agentsOf(1, [
            session(2, { parent: 1, activeAt: null }),
            session(3, { parent: 1, activeAt: null }),
        ]);

        assert.deepEqual(ids(rows), [3, 2]);
    });
});

void describe("finishedAgo", () => {
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);
    const MINUTE = 60_000;

    void it("says minutes, hours and days, each cut down", () => {
        assert.equal(finishedAgo(now - 4 * MINUTE - 59_000, now), "4m ago");
        assert.equal(finishedAgo(now - 59 * MINUTE, now), "59m ago");
        assert.equal(finishedAgo(now - 60 * MINUTE, now), "1h ago");
        assert.equal(finishedAgo(now - 23 * 60 * MINUTE, now), "23h ago");
        assert.equal(finishedAgo(now - 24 * 60 * MINUTE, now), "1d ago");
        assert.equal(finishedAgo(now - 10 * 24 * 60 * MINUTE, now), "10d ago");
    });

    void it("never says 0m, and does not go negative when the clock is behind", () => {
        assert.equal(finishedAgo(now - 20_000, now), "just now");
        assert.equal(finishedAgo(now + 5 * MINUTE, now), "just now");
    });

    void it("drops the time when the session has none", () => {
        assert.equal(finishedAgo(undefined, now), "finished");
        assert.equal(age(now - 2 * MINUTE, now), "2m");
    });
});

void describe("working agents", () => {
    const all = [
        session(1),
        session(2, { parent: 1, busy: true }),
        session(3, { parent: 1, busy: false }),
        session(4, { parent: 5, busy: true }),
        session(5, { busy: true }),
        session(6),
    ];

    void it("counts the busy sessions that have a parent, over every parent, not the open one", () => {
        assert.equal(workingAgentCount(all, null), 2);
        assert.equal(workingAgentCount(all, 2), 1);
        assert.equal(workingAgentCount([session(1, { busy: true })], null), 0);
    });

    void it("marks a session that has an agent working, not one whose agents are all done", () => {
        const marked = all.filter((one) => hasWorkingAgent(one, all)).map((one) => one.id);

        assert.deepEqual(marked, [1, 5]);
        assert.equal(hasWorkingAgent(session(7), [session(8, { parent: 7 })]), false);
    });
});
