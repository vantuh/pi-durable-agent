import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";

void it("recovers only corrupt live state, backs up originals and preserves messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recover-live-"));
    const file = join(dir, "state.sqlite");
    const db = new DatabaseSync(file);
    try {
        for (const table of [
            "conversations",
            "entries",
            "submissions",
            "tasks",
            "record_ids",
            "durable_metadata",
            "durable_schema",
        ]) {
            db.exec(`CREATE TABLE ${table} (record TEXT)`);
            db.prepare(`INSERT INTO ${table} VALUES (?)`).run("preserve me");
        }
        db.exec("CREATE TABLE documents (id INTEGER, kind TEXT, record TEXT)");
        db.exec(
            "CREATE TABLE document_revisions (document_id INTEGER, seq INTEGER, kind TEXT, version INTEGER, content TEXT)",
        );
        const initial = JSON.stringify({ generation: { attempt: 1 } });
        const broken = JSON.stringify([
            ["s", ["generation", "attempt"], 2],
            ["a", ["generation", "message", "content", 0, "text"], "lost partial"],
        ]);
        for (const [id, kind] of [
            [1, "pi.live"],
            [2, "pi.live"],
            [3, "other.doc"],
        ] as const) {
            db.prepare("INSERT INTO documents VALUES (?, ?, ?)").run(
                id,
                JSON.stringify(kind),
                JSON.stringify({ scope: { conversationId: id } }),
            );
            db.prepare("INSERT INTO document_revisions VALUES (?, 1, 'base', 1, ?)").run(
                id,
                initial,
            );
            db.prepare("INSERT INTO document_revisions VALUES (?, 2, 'delta', 1, ?)").run(
                id,
                id === 2 ? JSON.stringify([["s", ["generation", "attempt"], 2]]) : broken,
            );
        }
        const rows = () =>
            db.prepare("SELECT * FROM document_revisions ORDER BY document_id, seq").all();
        const before = rows();
        const run = () =>
            execFileSync(process.execPath, ["scripts/recover-live.mjs", file], {
                encoding: "utf8",
            });
        assert.match(run(), /Recovered sessions: 1\n/);
        const recovered = db
            .prepare(
                "SELECT kind, content FROM document_revisions WHERE document_id = 1 AND seq = 2",
            )
            .get();
        assert.equal(recovered?.["kind"], "base");
        assert.equal(recovered?.["content"], initial);
        assert.deepEqual(rows().slice(2), before.slice(2));
        assert.deepEqual(db.prepare("SELECT record FROM entries").get()?.["record"], "preserve me");
        const saved = (await readdir(dir)).find((name) => name.includes("before-live-recovery"));
        assert.ok(saved);
        const backup = new DatabaseSync(join(dir, saved), { readOnly: true });
        try {
            assert.deepEqual(
                backup.prepare("SELECT * FROM document_revisions ORDER BY document_id, seq").all(),
                before,
            );
        } finally {
            backup.close();
        }
        assert.match(run(), /Recovered sessions: none\n/);

        db.prepare("INSERT INTO document_revisions VALUES (1, 3, 'delta', 1, ?)").run(broken);
        db.prepare("INSERT INTO document_revisions VALUES (2, 3, 'delta', 1, ?)").run("not JSON");
        const beforeFailure = rows();
        assert.throws(
            () =>
                execFileSync(process.execPath, ["scripts/recover-live.mjs", file], {
                    stdio: "pipe",
                }),
            /Command failed/,
        );
        assert.deepEqual(rows(), beforeFailure, "Unexpected errors must roll back all repairs");
    } finally {
        db.close();
        await rm(dir, { recursive: true, force: true });
    }
});
