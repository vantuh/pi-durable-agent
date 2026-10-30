// Test: one file replaced in one step, one write at a time per path.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { writeJsonFile } from "../server/atomic-write.ts";

void describe("writeJsonFile", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "atomic-write-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("resolves every write to one path and leaves the last value on disk", async () => {
        const file = join(dir, "state.json");
        const writes = Array.from({ length: 16 }, (_each, index) => writeJsonFile(file, { index }));

        await Promise.all(writes);

        assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { index: 15 });
    });

    void it("creates the folder, and a failed write rejects while the next one lands", async () => {
        const blocked = join(dir, "a-file-where-a-folder-should-be");

        await writeFile(blocked, "");

        await assert.rejects(writeJsonFile(join(blocked, "state.json"), { off: true }));
        await writeJsonFile(join(dir, "deeper", "state.json"), { off: true });

        assert.deepEqual(JSON.parse(await readFile(join(dir, "deeper", "state.json"), "utf8")), {
            off: true,
        });
    });

    void it("keeps the file's mode, even when the umask is stricter", async () => {
        const file = join(dir, "push.json");
        const before = process.umask(0o077);

        try {
            await writeJsonFile(file, { version: 1 }, { mode: 0o640 });
        } finally {
            process.umask(before);
        }

        assert.equal((await stat(file)).mode & 0o777, 0o640);
    });
});
