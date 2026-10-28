import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineTask, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

const Anchor = defineTask<null, { phase: "done" }, null>({
    name: "test.anchor",
    version: 1,
    initial: () => ({ phase: "done" }),
    phases: {
        done: (_task, runtime, context) =>
            runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                context,
            ),
    },
    abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

void describe("Sessions owner link", () => {
    void it("names the session that started a conversation, in the list and on its own", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-owner-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );

        try {
            const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });
            const parent = await sessions.create(dir);
            const alone = await sessions.create(dir);
            const child = await harness.commit(async (tx) => {
                const anchor = await tx.createTask(Anchor, null, {
                    ownership: { kind: "conversation" },
                    conversationId: parent.id,
                    background: true,
                });

                return await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
            }, BACKGROUND_CONTEXT);

            const rows = await sessions.list(() => false);
            const parentOf = (id: number): number | undefined =>
                rows.find((row) => row.id === id)?.parent;

            assert.equal(parentOf(child.id), Number(parent.id));
            assert.equal(await sessions.owner(child.id), Number(parent.id));

            assert.equal(
                parentOf(parent.id),
                undefined,
                "a session a person created has no parent",
            );
            assert.equal(parentOf(alone.id), undefined);
            assert.equal(await sessions.owner(alone.id), undefined);
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
