/**
 * Deleting a session for good. The harness treats conversations and their entries as immutable and has no
 * delete call, so the rows go straight out of SQLite — which is only safe while no harness holds them.
 * A deleted id is therefore queued in `deleted.json`, hidden from the list at once, and purged on the next
 * start, before the harness opens the storage.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

const FILE = "deleted.json";

/** Ids deleted since the last start. */
export async function queued(dataDir: string): Promise<number[]> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dataDir, FILE), "utf8"));

        return Array.isArray(parsed)
            ? parsed.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
            : [];
    } catch {
        return [];
    }
}

/** Remembers a deletion; the purge happens at the next start. */
export async function queue(dataDir: string, id: number): Promise<void> {
    const ids = await queued(dataDir);

    if (ids.includes(id)) {
        return;
    }

    await writeFile(join(dataDir, FILE), JSON.stringify([...ids, id]));
}

/** Removes every row of the queued conversations, then empties the queue. */
export async function purge(dataDir: string, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) {
        return;
    }

    const db = await openNodeSqliteDatabase(join(dataDir, "state.sqlite"));

    try {
        await db.transaction(async (tx) => {
            for (const id of ids) {
                // Nothing in this app forks a conversation or spawns one from a task, so one id is all of it.
                const documents =
                    "SELECT id FROM documents WHERE (scope_kind = 'conversation' AND owner_id = ?1) OR (scope_kind = 'task' AND owner_id IN (SELECT id FROM tasks WHERE conversation_id = ?1))";

                await tx.run(
                    `DELETE FROM document_revisions WHERE document_id IN (${documents})`,
                    id,
                );
                await tx.run(`DELETE FROM documents WHERE id IN (${documents})`, id);
                await tx.run("DELETE FROM entries WHERE conversation_id = ?1", id);
                await tx.run("DELETE FROM submissions WHERE conversation_id = ?1", id);
                await tx.run("DELETE FROM tasks WHERE conversation_id = ?1", id);
                await tx.run("DELETE FROM conversations WHERE id = ?1", id);
            }
        });
    } finally {
        await db.close();
    }

    await writeFile(join(dataDir, FILE), "[]");
}
