import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { observeNewConversations } from "../server/new-conversations.ts";

void describe("observeNewConversations", () => {
    void it("hears of a conversation created after it started, once, and of no other commit", async () => {
        const dir = await mkdtemp(join(tmpdir(), "new-conversations-"));
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const model = { provider: "p", modelId: "m" };
        const create = () =>
            harness.createConversation(
                { ownership: { kind: "ownerless" }, agent: { model, cwd: dir } },
                BACKGROUND_CONTEXT,
            );

        try {
            const before = await create();
            const heard: number[] = [];
            const stop = observeNewConversations(harness, (id) => heard.push(id));
            const after = await create();

            await harness.commit(async (tx) => {
                await tx.appendEntry(before.id, { kind: "pi.user", data: { text: "hi" } });
            }, BACKGROUND_CONTEXT);
            await delay(50);

            assert.deepEqual(heard, [Number(after.id)]);

            stop();
            await create();
            await delay(50);

            assert.deepEqual(heard, [Number(after.id)], "a stopped watch hears nothing");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
