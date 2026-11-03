// Test: one JSON read for the stores — nothing saved yet means undefined, a mistake is thrown.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readJsonFile } from "../server/json-file.ts";

void describe("readJsonFile", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "json-file-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("gives the value, and undefined for a missing file or one that is not JSON", async () => {
        const file = join(dir, "state.json");

        assert.equal(await readJsonFile(file), undefined, "a missing file is nothing saved yet");

        await writeFile(file, "{ not json");
        assert.equal(await readJsonFile(file), undefined, "a broken file is nothing saved yet");

        await writeFile(file, '{"off":true}\n');
        assert.deepEqual(await readJsonFile(file), { off: true });
    });

    void it("throws when the path is not a file, which is not the same as empty", async () => {
        await mkdir(join(dir, "state.json"));

        await assert.rejects(readJsonFile(join(dir, "state.json")));
    });
});
