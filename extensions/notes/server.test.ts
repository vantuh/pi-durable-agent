import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { asTodos, type Note, type Todo, type WriteResult } from "./refs.ts";
import { actions, noteFile, repositoryOf, takeTasks, todosFile } from "./server.ts";

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

    const todos = async (name: string, args?: unknown): Promise<Todo[]> =>
        asTodos(await call(name, repo, args));
    const titles = (list: Todo[]): string[] => list.map((todo) => todo.title);

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
        assert.deepEqual((await readdir(join(data, "notes"))).toSorted(), [
            noteFile(data, repo).split("/").pop(),
            todosFile(noteFile(data, repo)).split("/").pop(),
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

    void it("takes checkbox lines with a title out of a note", () => {
        const { tasks, rest } = takeTasks(
            "intro\n- [ ] a\n  * [x] b \n- [ ]\n-[ ] c\ntext - [ ] d",
        );

        assert.deepEqual(tasks, [
            { title: "a", done: false },
            { title: "b", done: true },
        ]);
        assert.equal(rest, "intro\n- [ ]\n-[ ] c\ntext - [ ] d");
    });

    void it("moves the note's checkboxes into the to-dos once", async () => {
        await mkdir(join(data, "notes"), { recursive: true });
        await writeFile(noteFile(data, repo), "plan\n- [ ] one\n- [x] two\n");

        assert.equal((await read(repo)).text, "plan\n");
        assert.deepEqual(await todos("todos"), [
            { id: 1, title: "one", description: "", done: false },
            { id: 2, title: "two", description: "", done: true },
        ]);

        const later = await write(repo, "plan\n- [ ] stays\n", (await read(repo)).version);

        assert.equal(later.conflict, false);
        assert.equal((await read(repo)).text, "plan\n- [ ] stays\n");
        assert.equal((await todos("todos")).length, 2);
    });

    void it("takes the checkboxes out once when the first reads and changes arrive together", async () => {
        await mkdir(join(data, "notes"), { recursive: true });
        await writeFile(noteFile(data, repo), "plan\n- [ ] one\n");

        const [, , note] = await Promise.all([
            todos("addTodo", { title: "two" }),
            todos("addTodo", { title: "three" }),
            read(repo),
        ]);

        assert.equal(note.text, "plan\n");
        assert.deepEqual(titles(await todos("todos")), ["one", "two", "three"]);
        assert.equal(await readFile(noteFile(data, repo), "utf8"), "plan\n");
    });

    void it("adds, edits, moves and removes to-dos, and restores a removed one in place", async () => {
        assert.deepEqual(await todos("todos"), []);

        await todos("addTodo", { title: "  a  " });
        await todos("addTodo", { title: "b" });
        await todos("addTodo", { title: "c" });

        const edited = await todos("updateTodo", { id: 2, description: "long", done: true });

        assert.deepEqual(edited[1], { id: 2, title: "b", description: "long", done: true });
        assert.deepEqual(titles(await todos("moveTodo", { id: 3, over: 1 })), ["c", "a", "b"]);

        const [removed] = (await todos("todos")).filter((todo) => todo.id === 1);

        assert.deepEqual(titles(await todos("removeTodo", { id: 1 })), ["c", "b"]);
        await todos("restoreTodo", { todo: removed, index: 1 });
        assert.deepEqual(titles(await todos("restoreTodo", { todo: removed, index: 1 })), [
            "c",
            "a",
            "b",
        ]);
        assert.deepEqual(titles(await todos("addTodo", { title: "d" })), ["c", "a", "b", "d"]);
        assert.equal((await todos("todos")).at(-1)?.id, 4);
    });

    void it("refuses an empty title and an unknown to-do", async () => {
        await assert.rejects(todos("addTodo", { title: " " }), /title must be/);
        await assert.rejects(todos("updateTodo", { id: 9, done: true }), /No to-do 9/);
        assert.equal(await call("todos", null), null);
    });
});
