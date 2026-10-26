// Stop the server before running: node scripts/recover-live.mjs [database-path]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";

import { apply, PathError } from "@earendil-works/chord/delta";

const file = process.argv[2] ?? "data/state.sqlite";
const saved = `${file}.before-live-recovery-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
const source = new DatabaseSync(file, { readOnly: true });
try {
    await backup(source, saved);
} finally {
    source.close();
}
console.log("Backup:", saved);

const db = new DatabaseSync(file);
const tables = [
    "conversations",
    "entries",
    "submissions",
    "documents",
    "tasks",
    "record_ids",
    "durable_metadata",
    "durable_schema",
];
const fingerprints = () =>
    tables.map((table) =>
        createHash("sha256")
            .update(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
            .digest("hex"),
    );

db.exec("BEGIN IMMEDIATE");
try {
    const before = fingerprints();
    const count = db.prepare("SELECT count(*) AS count FROM document_revisions").get().count;
    const repaired = [];
    for (const row of db
        .prepare("SELECT id, record FROM documents WHERE kind = ?")
        .all(JSON.stringify("pi.live"))) {
        const base = db
            .prepare(
                "SELECT * FROM document_revisions WHERE document_id = ? AND kind = 'base' ORDER BY seq DESC LIMIT 1",
            )
            .get(row.id);
        assert.ok(base, `Document ${row.id} has no base`);
        let value = JSON.parse(base.content);
        const tail = db
            .prepare(
                "SELECT * FROM document_revisions WHERE document_id = ? AND seq > ? ORDER BY seq",
            )
            .all(row.id, base.seq);
        let corrupt = false;
        for (const delta of tail) {
            assert.equal(delta.kind, "delta");
            assert.equal(delta.version, base.version);
            try {
                value = apply(structuredClone(value), JSON.parse(delta.content));
            } catch (error) {
                if (!(error instanceof PathError)) {
                    throw error;
                }
                corrupt = true;
                break;
            }
        }
        if (corrupt) {
            const last = tail.at(-1);
            assert.equal(last.version, base.version);
            // Keep the last fully readable state; a failed apply may have partially mutated its input.
            const result = db
                .prepare(
                    "UPDATE document_revisions SET kind = 'base', content = ? WHERE document_id = ? AND seq = ?",
                )
                .run(JSON.stringify(value), row.id, last.seq);
            assert.equal(result.changes, 1);
            repaired.push(JSON.parse(row.record).scope.conversationId);
        }
    }
    assert.deepEqual(fingerprints(), before, "Session records and messages must remain unchanged");
    assert.equal(db.prepare("SELECT count(*) AS count FROM document_revisions").get().count, count);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    db.exec("COMMIT");
    console.log("Recovered sessions:", repaired.join(", ") || "none");
    console.log("Session records and messages unchanged; SQLite integrity ok.");
} catch (error) {
    db.exec("ROLLBACK");
    throw error;
} finally {
    db.close();
}
