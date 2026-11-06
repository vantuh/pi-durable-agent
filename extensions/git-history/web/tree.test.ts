import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FileTree } from "@pierre/trees";

import { treeFiles } from "./tree.ts";

const file = (path: string) => ({ id: path, path, added: 1, deleted: 0 });

void describe("changed-file paths", () => {
    void it("keeps ordinary paths and file metadata unchanged", () => {
        const files = [file("web/src/a.ts"), file("readme.md"), file("web/b.ts")];
        const paths = treeFiles(files);
        assert.deepEqual(
            [...paths.keys()],
            files.map((each) => each.path),
        );
        assert.equal(paths.get("web/src/a.ts"), files[0]);
    });

    void it("renders file/directory replacements without losing either diff or colliding with real names", () => {
        const files = [file("a"), file("a/b.ts"), file("a (file)"), file("a (file) (file)/c.ts")];
        const paths = treeFiles(files);
        assert.equal(paths.get("a (file) (file) (file)"), files[0]);
        assert.equal(paths.get("a/b.ts"), files[1]);
        assert.equal(paths.size, files.length);
        const tree = new FileTree({ paths: [...paths.keys()], initialExpansion: "open" });
        try {
            const rows = tree.getVisibleRows(0, 20).filter((row) => row.kind === "file");
            assert.deepEqual(
                new Set(rows.map((row) => paths.get(row.path)?.id)),
                new Set(files.map((each) => each.id)),
            );
        } finally {
            tree.cleanUp();
        }
    });
});
