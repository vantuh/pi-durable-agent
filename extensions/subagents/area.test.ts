import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../../shared/protocol.ts";
import { age, agentsOf, areaParent, endedAtOf, finishedAgo } from "./area.ts";

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
            session(2, { parent: 1, activeAt: 500 }),
            session(3, { parent: 1, activeAt: 900 }),
            session(4, { parent: 1, activeAt: 100, busy: true }),
            session(5, { parent: 1, activeAt: 300, busy: true }),
            session(6, { parent: 7, busy: true }),
            session(7),
        ]);

        assert.deepEqual(ids(rows), [5, 4, 3, 2]);
    });

    void it("places a finished agent by when its run ended, where that is known", () => {
        const rows = agentsOf(
            1,
            [
                session(2, { parent: 1, activeAt: 100 }),
                session(3, { parent: 1, activeAt: 300 }),
                session(4, { parent: 1, activeAt: 200 }),
            ],
            new Map([[2, 900]]),
        );

        assert.deepEqual(ids(rows), [2, 3, 4]);
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
        assert.equal(finishedAgo(now - 4 * MINUTE - 59_000, now), "finished 4m ago");
        assert.equal(finishedAgo(now - 59 * MINUTE, now), "finished 59m ago");
        assert.equal(finishedAgo(now - 60 * MINUTE, now), "finished 1h ago");
        assert.equal(finishedAgo(now - 23 * 60 * MINUTE, now), "finished 23h ago");
        assert.equal(finishedAgo(now - 24 * 60 * MINUTE, now), "finished 1d ago");
        assert.equal(finishedAgo(now - 10 * 24 * 60 * MINUTE, now), "finished 10d ago");
    });

    void it("never says 0m, and does not go negative when the clock is behind", () => {
        assert.equal(finishedAgo(now - 20_000, now), "finished just now");
        assert.equal(finishedAgo(now + 5 * MINUTE, now), "finished just now");
    });

    void it("drops the time when the session has none", () => {
        assert.equal(finishedAgo(null, now), "finished");
        assert.equal(age(now - 2 * MINUTE, now), "2m");
    });
});

void describe("endedAtOf", () => {
    void it("keeps only the agents whose end is known", () => {
        const ended = endedAtOf([
            { session: 2, endedAt: 50 },
            { session: 3, endedAt: null },
        ]);

        assert.deepEqual([...ended], [[2, 50]]);
    });
});
