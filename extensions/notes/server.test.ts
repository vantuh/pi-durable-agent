import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { openTasks, type Note, type WriteResult } from "./refs.ts";
import { actions, noteFile, repositoryOf } from "./server.ts";

const run = promisify(execFile);

void describe("notes", () => {
    let dir: string;
    let data: string;
    let repo: string;
    let worktree: string;

    const git = (cwd: string, args: string[]) =>
        run(
            "git",
            ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
            { cwd },
        );

    const call = (name: string, cwd: string | null, args?: unknown): Promise<unknown> => {
        const action = actions({ dataDir: data })[name];

        assert.ok(action);

        return Promise.resolve(action({ args, session: cwd === null ? null : { id: 1, cwd } }));
    };
    const read = async (cwd: string): Promise<Note> => {
        const note = await call("read", cwd);

        assert.ok(note !== null && typeof note === "object");

        return {
            text: String(Reflect.get(note, "text")),
            version: String(Reflect.get(note, "version")),
        };
    };
    const write = async (cwd: string, text: string, base: string): Promise<WriteResult> => {
        const result = await call("write", cwd, { text, base });

        assert.ok(typeof result === "object" && result !== null);

        const version = String(Reflect.get(result, "version"));

        return Reflect.get(result, "conflict") === true
            ? { conflict: true, text: String(Reflect.get(result, "text")), version }
            : { conflict: false, version };
    };

    beforeEach(async () => {
        dir = await realpath(await mkdtemp(join(tmpdir(), "notes-test-")));
        data = join(dir, "data");
        repo = join(dir, "repo");
        worktree = join(dir, "repo-wt");
        await mkdir(join(repo, "src"), { recursive: true });
        await run("git", ["init", "-b", "main", repo]);
        await writeFile(join(repo, "file"), "first\n");
        await git(repo, ["add", "file"]);
        await git(repo, ["commit", "-m", "first"]);
        await git(repo, ["worktree", "add", "-b", "feature", worktree]);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("gives every worktree and subfolder of one repository the same note", async () => {
        assert.equal(await repositoryOf(join(repo, "src")), repo);
        assert.equal(await repositoryOf(worktree), repo);

        const saved = await write(repo, "shared\n", (await read(repo)).version);

        assert.equal(saved.conflict, false);
        assert.equal((await read(worktree)).text, "shared\n");
        assert.equal((await read(join(repo, "src"))).text, "shared\n");
        assert.deepEqual(await readdir(join(data, "notes")), [
            noteFile(data, repo).split("/").pop(),
        ]);
    });

    void it("keys a folder outside git by the folder itself", async () => {
        const plain = join(dir, "plain");

        await mkdir(plain);

        assert.equal(await repositoryOf(plain), plain);
        await write(plain, "mine", (await read(plain)).version);
        assert.equal((await read(plain)).text, "mine");
        assert.equal((await read(repo)).text, "");
    });

    void it("reads a missing note as empty and a session without a folder as no note", async () => {
        assert.equal((await read(repo)).text, "");
        assert.equal(await call("read", null), null);
    });

    void it("refuses a write on a stale base and leaves the file unchanged", async () => {
        const first = await read(repo);

        await write(repo, "one", first.version);

        const refused = await write(worktree, "two", first.version);

        assert.equal(refused.conflict, true);
        assert.equal(refused.conflict && refused.text, "one");
        assert.equal(await readFile(noteFile(data, repo), "utf8"), "one");
    });

    void it("accepts a write on the current base and returns the next version", async () => {
        const first = await read(repo);
        const one = await write(repo, "one", first.version);

        assert.equal(one.conflict, false);

        const two = await write(repo, "two", one.version);

        assert.equal(two.conflict, false);
        assert.equal((await read(repo)).version, two.version);
        assert.equal(await readFile(noteFile(data, repo), "utf8"), "two");
    });

    void it("lets only one of two instances write on the same base", async () => {
        const base = (await read(repo)).version;
        const [one, two] = await Promise.all(
            ["one", "two"].map(async (text) => {
                const result = await actions({ dataDir: data })["write"]?.({
                    args: { text, base },
                    session: { id: 1, cwd: repo },
                });

                assert.ok(typeof result === "object" && result !== null);

                return { conflict: Reflect.get(result, "conflict"), text };
            }),
        );

        assert.deepEqual([one?.conflict, two?.conflict], [false, true]);
        assert.equal(await readFile(noteFile(data, repo), "utf8"), "one");
    });

    void it("rejects arguments that are not text and a base", async () => {
        await assert.rejects(call("write", repo, { text: 1, base: "" }), /args must be/);
    });

    void it("counts open checkboxes at any indentation", () => {
        assert.equal(openTasks("- [ ] a\n  * [ ] b\n- [x] c\n- [ ]\n-[ ] d\ntext - [ ] e"), 3);
    });
});
