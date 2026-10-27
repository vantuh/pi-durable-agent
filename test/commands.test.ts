import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { runCommand } from "../server/commands.ts";

const models = await ModelRuntime.create();
const model = models.getAvailableSnapshot()[0];

if (model === undefined) {
    throw new Error("this machine has no model to open a conversation with");
}

void describe("commands", () => {
    void it("answers that a conversation too short to summarize has nothing to compact", async () => {
        const dir = await mkdtemp(join(tmpdir(), "commands-"));
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            {
                models,
                registry: createRegistry(),
                env: () => new NodeExecutionEnv({ cwd: dir }),
            },
            BACKGROUND_CONTEXT,
        );

        try {
            const conversation = await harness.createConversation(
                {
                    ownership: { kind: "ownerless" },
                    agent: {
                        model: { provider: model.provider, modelId: model.id },
                        cwd: dir,
                    },
                },
                BACKGROUND_CONTEXT,
            );

            await conversation.commit(async (tx) => {
                await tx.appendEntry(conversation.id, { kind: "pi.user", data: { text: "hi" } });
                await tx.appendEntry(conversation.id, { kind: "pi.assistant" });
            }, BACKGROUND_CONTEXT);

            const result = await runCommand("compact", {
                conversation,
                harness,
                context: BACKGROUND_CONTEXT,
                args: "",
            });

            assert.deepEqual(result, { status: "empty" });
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
