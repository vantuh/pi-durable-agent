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

import { Sessions } from "../server/sessions.ts";

void describe("Sessions.delete", () => {
    void it("keeps the transcript but hides the session from every list, also after a restart", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-delete-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const open = async (): Promise<Harness> =>
            Harness.open(
                await openNodeSqliteStorage(join(dir, "state.sqlite")),
                {
                    models,
                    registry: createRegistry(),
                    env: () => new NodeExecutionEnv({ cwd: dir }),
                },
                BACKGROUND_CONTEXT,
            );
        const sessionsOf = (harness: Harness): Sessions =>
            new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });

        const harness = await open();
        const sessions = sessionsOf(harness);
        const deleted = await sessions.create(dir);
        const kept = await sessions.create(dir);

        await harness.commit(
            (tx) => tx.appendEntry(deleted.id, { kind: "test.note", data: { text: "hi" } }),
            BACKGROUND_CONTEXT,
        );

        try {
            await sessions.delete(deleted.id);

            assert.deepEqual(
                (await sessions.list(() => false)).map((row) => row.id),
                [kept.id],
                "a deleted session is not listed",
            );
            assert.equal(await sessions.open(deleted.id), undefined, "and cannot be opened");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }

        const reopened = await open();

        try {
            const listed = await sessionsOf(reopened).list(() => false);

            assert.deepEqual(
                listed.map((row) => row.id),
                [kept.id],
                "the note survives the restart",
            );
            assert.ok(
                await reopened.conversation(deleted.id, BACKGROUND_CONTEXT),
                "the deleted conversation is still in storage",
            );
            assert.equal(
                (
                    await reopened.commit(
                        (tx) => tx.scanEntries({ conversationId: deleted.id }, 10),
                        BACKGROUND_CONTEXT,
                    )
                ).items.length,
                1,
                "and so is its transcript",
            );
        } finally {
            await reopened.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
