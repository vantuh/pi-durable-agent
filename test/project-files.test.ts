import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { projectFiles } from "../server/project-files.ts";

void test("a folder outside git is walked, without node_modules", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "project-files-"));

    try {
        mkdirSync(join(cwd, "src"));
        mkdirSync(join(cwd, "node_modules"));
        writeFileSync(join(cwd, "src", "a.ts"), "");
        writeFileSync(join(cwd, "b.md"), "");
        writeFileSync(join(cwd, "node_modules", "c.js"), "");

        assert.deepEqual((await projectFiles(cwd)).toSorted(), ["b.md", "src/a.ts"]);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
