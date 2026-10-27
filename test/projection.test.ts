import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectLive } from "../server/projection.ts";

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

    void it("lists no writes and nothing when the inbox is empty", () => {
        assert.equal(
            projectLive(undefined, undefined, inbox([{ id: 10, mode: "write", entry: {} }])).queued,
            undefined,
        );
        assert.equal(projectLive(undefined, undefined, inbox([])).queued, undefined);
    });
});
