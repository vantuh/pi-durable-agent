import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
    openNodeSqliteDatabase,
    openNodeSqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite/node";

import { purge, queued } from "../server/purge.ts";
import { Sessions } from "../server/sessions.ts";

void describe("Sessions.delete", () => {
    void it("hides the session at once and removes its rows at the next start", async () => {
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

        const harness = await open();
        const sessions = new Sessions({
            harness,
            model,
            models,
            context: BACKGROUND_CONTEXT,
            dataDir: dir,
        });
        const deleted = await sessions.create(dir);
        const kept = await sessions.create(dir);

        await harness.commit(
            (tx) => tx.appendEntry(deleted.id, { kind: "test.note", data: { text: "hi" } }),
            BACKGROUND_CONTEXT,
        );

        try {
            await sessions.delete(deleted.id);

            assert.equal(
                (await sessions.list(() => false)).some((row) => row.id === deleted.id),
                false,
                "a deleted session is not listed",
            );
            assert.equal(await sessions.open(deleted.id), undefined, "and cannot be opened");
            assert.deepEqual(
                (await sessions.list(() => false)).map((row) => row.id),
                [kept.id],
            );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }

        await purge(dir, await queued(dir));

        const reopened = await open();

        try {
            assert.equal(
                await reopened.conversation(deleted.id, BACKGROUND_CONTEXT),
                undefined,
                "the conversation row is gone",
            );
            assert.equal(
                (await reopened.commit((tx) => tx.scanConversations({}, 10), BACKGROUND_CONTEXT))
                    .items.length,
                1,
                "the other conversation stays",
            );
        } finally {
            await reopened.close(BACKGROUND_CONTEXT);
        }

        const db = await openNodeSqliteDatabase(join(dir, "state.sqlite"));

        try {
            for (const table of ["entries", "tasks", "submissions"]) {
                const [row] = await db.all<{ n: number }>(
                    `SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = ?1`,
                    Number(deleted.id),
                );

                assert.equal(row?.n, 0, `no rows left in ${table}`);
            }

            const [documents] = await db.all<{ n: number }>(
                "SELECT COUNT(*) AS n FROM documents WHERE scope_kind = 'conversation' AND owner_id = ?1",
                Number(deleted.id),
            );

            assert.equal(documents?.n, 0, "no conversation documents left");
            const [orphans] = await db.all<{ n: number }>(
                "SELECT COUNT(*) AS n FROM document_revisions WHERE document_id NOT IN (SELECT id FROM documents)",
            );

            assert.equal(orphans?.n, 0, "no revisions left behind");
        } finally {
            await db.close();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
