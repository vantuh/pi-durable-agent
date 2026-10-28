import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineDoc, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

const NotesDoc = defineDoc({
    kind: "test.notes",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { notes: string[] } => ({ notes: [] }),
    checkpointWhen: () => true,
});

void describe("Sessions.readDoc", () => {
    void it("reads what a commit wrote, and reads an absent document without creating it", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-read-doc-"));
        const file = join(dir, "state.sqlite");
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(file),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const rows = (): { documents: number; revisions: number } => {
            const db = new DatabaseSync(file, { readOnly: true });

            try {
                const count = (table: string): number => {
                    const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get();

                    return typeof row?.["n"] === "number" ? row["n"] : -1;
                };

                return { documents: count("documents"), revisions: count("document_revisions") };
            } finally {
                db.close();
            }
        };

        try {
            const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });
            const written = await sessions.create(dir);
            const untouched = await sessions.create(dir);

            await harness.commit(async (tx) => {
                (await tx.doc(NotesDoc, written.id)).notes.push("first", "second");
            }, BACKGROUND_CONTEXT);

            assert.deepEqual(await sessions.readDoc(NotesDoc, written.id), {
                notes: ["first", "second"],
            });

            const before = rows();

            assert.deepEqual(await sessions.readDoc(NotesDoc, untouched.id), { notes: [] });
            assert.deepEqual(rows(), before, "reading added no document and no revision");
            assert.equal(
                await harness.snapshot(NotesDoc, untouched.id, BACKGROUND_CONTEXT),
                undefined,
                "the document still does not exist",
            );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
