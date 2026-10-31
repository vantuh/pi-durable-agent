/**
 * The sidebar's list arrives as the whole list once and then as the rows a change touched, so a frame is applied
 * to what the screen already holds: a `sessions` frame replaces it, a `rows` frame upserts what it carries and
 * drops the ids it says are gone. Nothing else may move, or a row would vanish on the way past.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSummary } from "../shared/protocol.ts";
import { sessionsEventOf } from "../web/src/lib/api.ts";
import { withSessionsEvent } from "../web/src/lib/session-list.ts";

function row(id: number, title: string): SessionSummary {
    return {
        id,
        archived: false,
        name: null,
        title,
        cwd: null,
        model: "fx/m1",
        thinkingLevel: "off",
        busy: false,
        activeAt: 1,
        unseen: false,
    };
}

void describe("withSessionsEvent", () => {
    void it("replaces the whole list with a `sessions` frame", () => {
        const before = [row(1, "one"), row(2, "two")];
        const after = withSessionsEvent(before, {
            type: "sessions",
            sessions: [row(3, "three")],
        });

        assert.deepEqual(
            after.map((entry) => entry.title),
            ["three"],
        );
    });

    void it("upserts the rows a frame carries and keeps the rest", () => {
        const before = [row(1, "one"), row(2, "two")];
        const after = withSessionsEvent(before, {
            type: "rows",
            rows: [row(2, "renamed"), row(3, "new")],
            gone: [],
        });

        assert.deepEqual(
            after.map((entry) => [entry.id, entry.title]),
            [
                [1, "one"],
                [2, "renamed"],
                [3, "new"],
            ],
        );
    });

    void it("drops the id a frame says is gone", () => {
        const before = [row(1, "one"), row(2, "two")];
        const after = withSessionsEvent(before, {
            type: "rows",
            rows: [],
            gone: [1],
        });

        assert.deepEqual(
            after.map((entry) => entry.id),
            [2],
        );
    });

    void it("changes nothing for an id it does not hold", () => {
        const before = [row(1, "one")];
        const after = withSessionsEvent(before, {
            type: "rows",
            rows: [],
            gone: [7],
        });

        assert.equal(after.length, 1);
        assert.equal(after[0]?.id, 1);
    });
});

void describe("sessionsEventOf", () => {
    void it("reads the rows and the gone ids a `rows` frame carries", () => {
        const event = sessionsEventOf({
            type: "rows",
            rows: [{ id: 7, title: "seven" }],
            gone: [3, "not an id"],
        });

        if (event.type !== "rows") {
            assert.fail("a rows frame stays one");
        }

        assert.deepEqual(
            event.rows.map((entry) => [entry.id, entry.title]),
            [[7, "seven"]],
        );
        assert.deepEqual(event.gone, [3], "an id that is not a number drops nothing");
    });

    void it("reads anything else as the whole list", () => {
        const event = sessionsEventOf({ type: "sessions", sessions: [{ id: 4 }] });

        if (event.type !== "sessions") {
            assert.fail("a whole list stays one");
        }

        assert.deepEqual(
            event.sessions.map((entry) => entry.id),
            [4],
        );
    });
});
