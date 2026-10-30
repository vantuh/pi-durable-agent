import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { actions, listFolder } from "./server.ts";

void describe("files actions", () => {
    let dir: string;
    let outside: string;

    const call = (name: "list" | "read", path: string) => {
        const action = actions[name];

        assert.ok(action);

        return Promise.resolve(action({ args: { path }, session: { id: 1, cwd: dir } }));
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "files-test-"));
        outside = await mkdtemp(join(tmpdir(), "files-outside-"));
        await mkdir(join(dir, "sub"));
        await writeFile(join(dir, "a.txt"), "hello");
        await writeFile(join(dir, "bin.dat"), Buffer.from([1, 0, 2]));
        await writeFile(join(dir, "pic.png"), "x");
        await writeFile(join(outside, "secret.txt"), "secret");
        await symlink(outside, join(dir, "link"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    });

    void it("lists folders first", async () => {
        const folder = await call("list", "");

        assert.deepEqual(folder, {
            entries: [
                { name: "link", dir: true },
                { name: "sub", dir: true },
                { name: "a.txt", dir: false },
                { name: "bin.dat", dir: false },
                { name: "pic.png", dir: false },
            ],
            truncated: false,
        });
    });

    void it("sorts before it truncates, so a folder past the readdir order's first page is listed", async () => {
        const big = join(dir, "big");
        const count = 1200;

        await mkdir(big);
        for (let index = 0; index < count; index += 1) {
            await writeFile(join(big, `f${String(index).padStart(4, "0")}.txt`), "");
        }
        // Names sort after every file, and readdir does not: folders first puts it in the list anyway.
        await mkdir(join(big, "zzz-folder"));

        const folder = await listFolder(big);

        assert.equal(folder.truncated, true);
        assert.equal(folder.entries.length, 1000);
        assert.deepEqual(folder.entries[0], { name: "zzz-folder", dir: true });
        assert.deepEqual(
            folder.entries.slice(1, 4),
            [
                { name: "f0000.txt", dir: false },
                { name: "f0001.txt", dir: false },
                { name: "f0002.txt", dir: false },
            ],
            "the files dropped are the last by name, not by readdir order",
        );
    });

    void it("reads text, and names binary and image files", async () => {
        assert.deepEqual(await call("read", "a.txt"), {
            kind: "text",
            size: 5,
            text: "hello",
            truncated: false,
        });
        assert.deepEqual(await call("read", "bin.dat"), { kind: "binary", size: 3 });
        assert.deepEqual(await call("read", "pic.png"), { kind: "image", size: 1 });
    });

    void it("refuses paths that leave the folder", async () => {
        await assert.rejects(call("read", "../x"));
        await assert.rejects(call("read", "/etc/hosts"));
        await assert.rejects(call("read", "link/secret.txt"));
        await assert.rejects(call("list", "link"));
    });

    void it("has no action that writes", () => {
        assert.deepEqual(Object.keys(actions).sort(), ["list", "read"]);
    });
});
