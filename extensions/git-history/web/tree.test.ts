import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { treeOf } from "./tree.ts";

const file = (path: string) => ({ id: path, path, added: 1, deleted: 0 });

const shape = (branches: { name: string; file?: { id: string } }[]): string[] =>
    branches.map((branch) => (branch.file === undefined ? `${branch.name}/` : branch.name));

void describe("treeOf", () => {
    void it("nests paths by folder and puts folders before files, each by name", () => {
        const tree = treeOf([file("web/src/a.ts"), file("readme.md"), file("web/b.ts")]);

        assert.deepEqual(shape(tree), ["web/", "readme.md"]);
        assert.deepEqual(shape(tree[0]?.folders ?? []), ["src/", "b.ts"]);
        assert.equal(tree[0]?.folders[0]?.folders[0]?.file?.id, "web/src/a.ts");
        assert.equal(tree[0]?.folders[1]?.path, "web/b.ts");
    });

    void it("keeps the children of a path that is both a file and a folder", () => {
        const tree = treeOf([file("a"), file("a/b.ts")]);

        assert.equal(tree.length, 1);
        assert.equal(tree[0]?.file?.id, "a");
        assert.deepEqual(shape(tree[0]?.folders ?? []), ["b.ts"]);
    });
});
