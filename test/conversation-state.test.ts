import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClientEntry, ServerEvent } from "../shared/protocol.ts";
import { mergeEntries, START, withEvent, withOlder } from "../web/src/lib/conversation-state.ts";

const said = (id: number, text: string): ClientEntry => ({ id, kind: "user", text });

const entries = (ids: number[]): ServerEvent => ({
    type: "entries",
    session: 1,
    entries: ids.map((id) => said(id, `entry ${String(id)}`)),
    replace: true,
});

const idsOf = (list: readonly ClientEntry[]): number[] => list.map((entry) => entry.id);

void describe("mergeEntries", () => {
    void it("keeps what was already read when a compaction shortens the view", () => {
        const loaded = [said(1, "first"), said(2, "second"), said(3, "third")];

        assert.deepEqual(
            idsOf(mergeEntries(loaded, [said(3, "third"), said(4, "fourth")])),
            [1, 2, 3, 4],
            "the start of the conversation stays, and the new entry is added",
        );
    });

    void it("holds one copy of an entry handed out twice, in the log's order", () => {
        const loaded = [said(5, "fifth"), said(7, "seventh")];

        assert.deepEqual(
            idsOf(mergeEntries(loaded, [said(7, "seventh"), said(5, "fifth"), said(4, "fourth")])),
            [4, 5, 7],
            "an id is one entry, and a marker written later does not push an older one below it",
        );
    });

    void it("hands back the list it was given when nothing came in", () => {
        const loaded = [said(1, "first")];

        assert.equal(mergeEntries(loaded, []), loaded);
    });
});

void describe("withEvent", () => {
    void it("does not take the loaded start away when the server rewrites the view", () => {
        const read = { ...START, session: 1, entries: [said(1, "first"), said(2, "second")] };

        // What a compaction sends: the whole active view, shorter than what the browser has.
        assert.deepEqual(idsOf(withEvent(read, entries([2, 3])).entries), [1, 2, 3]);
    });

    void it("starts a session's list over on hello, so another session's entries never show", () => {
        const read = { ...START, session: 7, entries: [said(9, "from session 7")] };
        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [said(1, "hallo")],
            live: START.live,
            model: "m1",
            more: false,
        };

        assert.deepEqual(idsOf(withEvent(read, hello).entries), [1]);
        assert.equal(withEvent(read, hello).session, 1);
    });

    void it("keeps the pages read before a reconnect, and that the start is already on screen", () => {
        const read = withOlder(
            { ...START, session: 1, entries: [said(9, "the tail")] },
            {
                entries: [said(1, "the start"), said(2, "second")],
                more: false,
            },
        );
        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [said(9, "the tail"), said(10, "just committed")],
            live: START.live,
            model: "m1",
            more: true,
        };

        const reconnected = withEvent(read, hello);

        assert.deepEqual(
            idsOf(reconnected.entries),
            [1, 2, 9, 10],
            "the same session's stream only carries the newest page, and the rest is still the conversation",
        );
        assert.equal(
            reconnected.exhausted,
            true,
            "the start is on screen, so a reconnect does not make it worth asking for again",
        );
    });

    void it("drops the last session's error on hello", () => {
        const read = {
            ...START,
            session: 7,
            entries: [said(9, "from session 7")],
            issue: "the older messages did not arrive",
        };

        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [],
            live: START.live,
            model: "m1",
            more: false,
        };

        assert.equal(withEvent(read, hello).issue, null);
    });

    void it("knows from hello whether the start is still to be asked for", () => {
        const hello = (more: boolean): ServerEvent => ({
            type: "hello",
            session: 1,
            entries: [said(9, "the tail")],
            live: START.live,
            model: "m1",
            more,
        });

        assert.equal(withEvent(START, hello(true)).exhausted, false, "older entries are still out");
        assert.equal(
            withEvent(START, hello(false)).exhausted,
            true,
            "the screen holds the whole conversation, so nothing is asked for",
        );
    });
});
