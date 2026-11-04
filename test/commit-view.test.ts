import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
    ConversationId,
    ConversationView,
    EntryId,
    JsonObject,
    TaskId,
} from "@earendil-works/pi-durable";

import { commitView } from "../server/commit-view.ts";

/** An id as the harness brands it: the brand lives only in the type. */
const id = (value: number): ConversationId => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return value as ConversationId;
};
const entryId = (value: number): EntryId => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return value as EntryId;
};
const taskId = (value: number): TaskId => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return value as TaskId;
};
const entries = [{ id: entryId(1), conversationId: id(2), kind: "test" }];

const view = (owner: number | undefined, agent: JsonObject | undefined): ConversationView => ({
    conversation: {
        id: id(2),
        ...(owner === undefined ? {} : { owner: { conversationId: id(owner), taskId: taskId(1) } }),
    },
    entries,
    docs: agent === undefined ? {} : { "pi.agent": agent },
});

void describe("commitView", () => {
    void it("reads the folder the tools run in, and null when the agent has none", () => {
        const cwd = (agent: JsonObject | undefined): string | null =>
            commitView(view(undefined, agent), false).session.cwd;

        assert.equal(cwd({ cwd: "/work/tree" }), "/work/tree");
        assert.equal(cwd({}), null);
        assert.equal(cwd(undefined), null);
        assert.equal(cwd({ cwd: 7 }), null);
    });

    void it("names the owner of a session that something else started, and only then", () => {
        assert.equal(commitView(view(1, {}), false).session.owner, 1);
        assert.equal("owner" in commitView(view(undefined, {}), false).session, false);
    });

    void it("carries the busy value it was given, and the commit's own entries", () => {
        const made = commitView(view(undefined, {}), true);

        assert.equal(made.busy, true);
        assert.equal(made.entries, entries);
    });
});
