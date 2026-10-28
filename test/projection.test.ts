import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntryRecord } from "@earendil-works/pi-durable";

import { projectEntry, projectLive } from "../server/projection.ts";

void describe("live compaction", () => {
    void it("says a compaction is running while the harness lists one, and stops when it is done", () => {
        const running = projectLive(
            {
                compactions: [
                    {
                        taskId: 3,
                        reason: "threshold",
                        blocking: true,
                        attempt: 1,
                    },
                ],
            },
            undefined,
            undefined,
        );

        assert.equal(running.compacting, true, "the mark can spin while the summary is written");
        assert.equal(
            running.compactionRetrying,
            false,
            "a first attempt is not a retry, so the pill stays quiet",
        );
        assert.equal(projectLive({ compactions: [] }, undefined, undefined).compacting, undefined);
        assert.equal(projectLive({}, undefined, undefined).compacting, undefined);
    });

    void it("says a waiting attempt is a retry", () => {
        const live = projectLive(
            {
                compactions: [
                    {
                        taskId: 4,
                        reason: "manual",
                        blocking: false,
                        attempt: 2,
                        retry: { at: 1, error: "429" },
                    },
                ],
            },
            undefined,
            undefined,
        );

        assert.equal(live.compacting, true);
        assert.equal(live.compactionRetrying, true);
    });

    void it("keeps the failure the harness keeps, until a compaction succeeds", () => {
        const failed = projectLive(
            { compactionFailure: { taskId: 5, reason: "manual", error: "Compaction failed: 429" } },
            undefined,
            undefined,
        );

        assert.deepEqual(failed.compactionFailed, { error: "Compaction failed: 429" });
        assert.equal(failed.compacting, undefined, "nothing is running any more");
        assert.equal(
            projectLive(
                { compactionFailure: { taskId: 5, reason: "manual" } },
                undefined,
                undefined,
            ).compactionFailed,
            undefined,
            "no text to show, so no mark",
        );
    });
});

void describe("queued messages", () => {
    const inbox = (items: unknown[]) => ({ items });

    void it("shows what was typed, not the skill expansion the agent reads", () => {
        const live = projectLive(
            undefined,
            undefined,
            inbox([
                {
                    id: 7,
                    mode: "steer",
                    content: [{ type: "text", text: "skill instructions\n\nfix the test" }],
                    entry: { kind: "chat.user", data: { text: "/skill:tdd fix the test" } },
                },
            ]),
        );

        assert.deepEqual(live.queued, [{ id: 7, mode: "steer", text: "/skill:tdd fix the test" }]);
    });

    void it("carries the files of a queued input, with their paths", () => {
        const live = projectLive(
            undefined,
            undefined,
            inbox([
                {
                    id: 8,
                    mode: "followUp",
                    content: [{ type: "text", text: "look at this" }],
                    entry: {
                        kind: "chat.user",
                        data: {
                            text: "look at this",
                            files: [
                                {
                                    path: "/data/uploads/1-a.png",
                                    name: "a.png",
                                    size: 12,
                                    image: true,
                                },
                            ],
                        },
                    },
                },
            ]),
        );

        assert.deepEqual(live.queued, [
            {
                id: 8,
                mode: "followUp",
                text: "look at this",
                files: [{ path: "/data/uploads/1-a.png", name: "a.png", size: 12, image: true }],
            },
        ]);
    });

    void it("falls back to the message itself when the input carries no entry", () => {
        const live = projectLive(
            undefined,
            undefined,
            inbox([{ id: 9, mode: "steer", content: [{ type: "text", text: "plain words" }] }]),
        );

        assert.deepEqual(live.queued, [{ id: 9, mode: "steer", text: "plain words" }]);
    });

    void it("says who wrote a message the person did not type", () => {
        const live = projectLive(
            undefined,
            undefined,
            inbox([
                {
                    id: 11,
                    mode: "steer",
                    content: "[agent Scout (scout) finished]\n\nfound it",
                    entry: {
                        kind: "subagents.report",
                        data: { text: "found it", author: "Scout", session: 4 },
                    },
                },
            ]),
        );

        assert.deepEqual(live.queued, [
            { id: 11, mode: "steer", text: "found it", author: { name: "Scout", session: 4 } },
        ]);
    });

    void it("lists no writes and nothing when the inbox is empty", () => {
        assert.equal(
            projectLive(undefined, undefined, inbox([{ id: 10, mode: "write", entry: {} }])).queued,
            undefined,
        );
        assert.equal(projectLive(undefined, undefined, inbox([])).queued, undefined);
    });
});

void describe("messages the person did not type", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written entry, without the harness that brands its ids
    const entry = (value: object): EntryRecord => value as unknown as EntryRecord;
    const record = (kind: string, data: unknown): EntryRecord =>
        entry({
            id: 3,
            conversationId: 1,
            kind,
            data,
            model: [{ role: "user", content: "[agent Scout (scout) finished]\n\nfound it" }],
        });

    void it("shows an application input with an author as a message from it", () => {
        assert.deepEqual(
            projectEntry(
                record("subagents.report", { text: "found it", author: "Scout", session: 4 }),
            ),
            { id: 3, kind: "user", text: "found it", author: { name: "Scout", session: 4 } },
        );
    });

    void it("keeps an application entry without an author out of the conversation", () => {
        assert.deepEqual(projectEntry(record("other.input", { text: "found it" })), {
            id: 3,
            kind: "other",
            entryKind: "other.input",
        });
    });
});
