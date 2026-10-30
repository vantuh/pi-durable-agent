import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { stats as statsRef } from "./refs.ts";
import { actions } from "./server.ts";

const run = promisify(execFile);

void describe("git-stats", () => {
    let dir: string;
    let repo: string;
    const git = async (cwd: string, ...args: string[]) =>
        (await run("git", args, { cwd })).stdout.trim();
    const call = async (name: string, cwd: string | null = repo) => {
        const action = actions[name];
        assert.ok(action);
        return await action({ args: undefined, session: { id: 1, cwd } });
    };
    const stats = async (cwd = repo) => statsRef.parse(await call("stats", cwd));
    const failedStdout = (error: unknown): string => {
        if (
            typeof error === "object" &&
            error !== null &&
            "stdout" in error &&
            typeof error.stdout === "string"
        ) {
            return error.stdout;
        }
        throw error;
    };
    /** What real Git reports for that new file, whatever the code under test decides to do. */
    const numstatAdded = async (name: string): Promise<number> => {
        const output = await run(
            "git",
            ["diff", "--no-index", "--numstat", "--", "/dev/null", name],
            { cwd: repo },
        )
            .then((result) => result.stdout)
            // git diff --no-index exits 1 after a successful diff.
            .catch(failedStdout);
        const added = output.split("\t")[0] ?? "-";
        return added === "-" ? 0 : Number(added);
    };
    const commit = async (cwd = repo) => {
        await git(cwd, "add", ".");
        await git(
            cwd,
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "test",
        );
    };
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-stats-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git(repo, "init", "-b", "main");
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("hides outside Git and without a session", async () => {
        assert.equal(await call("stats", null), null);
        assert.equal(await stats(dir), null);
    });
    void it("counts net staged + unstaged changes, untracked files and ignores binaries", async () => {
        await writeFile(join(repo, "file"), "one\ntwo\nthree\n");
        await commit();
        await writeFile(join(repo, "file"), "one\nchanged\nthree\nfour\n");
        await git(repo, "add", ".");
        await writeFile(join(repo, "file"), "one\nchanged\nthree\nfour\nfive\n");
        await writeFile(join(repo, "new\tfile\nname"), "new\nline\n");
        await writeFile(join(repo, "binary"), Buffer.from([0, 1, 2, 3]));
        await writeFile(join(repo, ".gitignore"), "ignored\n");
        await writeFile(join(repo, "ignored"), "not counted\n");
        assert.deepEqual(await stats(), {
            added: 6,
            deleted: 1,
            ahead: 0,
            behind: 0,
            upstream: null,
        });
        await mkdir(join(repo, "sub"));
        assert.deepEqual(await stats(join(repo, "sub")), await stats());
    });
    void it("counts unborn branches without double counting staged edits", async () => {
        await writeFile(join(repo, "file"), "one\ntwo\n");
        await git(repo, "add", ".");
        await writeFile(join(repo, "file"), "one\n");
        assert.equal((await stats())?.added, 1);
        assert.equal((await stats())?.deleted, 0);
    });
    void it("handles deleted files, renames and detached HEAD", async () => {
        await writeFile(join(repo, "file"), "one\ntwo\n");
        await writeFile(join(repo, "removed"), "gone\n");
        await commit();
        await git(repo, "mv", "file", "renamed");
        await rm(join(repo, "removed"));
        await git(repo, "checkout", "--detach");
        assert.deepEqual(await stats(), {
            added: 0,
            deleted: 1,
            ahead: 0,
            behind: 0,
            upstream: null,
        });
        await assert.rejects(call("push"), /No upstream/);
    });
    void it("counts untracked lines the way Git's numstat does", async () => {
        await commit();
        await writeFile(join(repo, "with-newline"), "one\ntwo\n");
        await writeFile(join(repo, "without-newline"), "one\ntwo");
        await writeFile(join(repo, "empty"), "");
        await writeFile(join(repo, "binary"), Buffer.from("one\0two"));
        await symlink("with-newline", join(repo, "link"));
        let expected = 0;
        for (const name of ["with-newline", "without-newline", "empty", "binary", "link"]) {
            expected += await numstatAdded(name);
        }
        assert.equal(expected, 5);
        assert.equal((await stats())?.added, expected);
    });
    void it("counts many untracked files without running Git for each one", async () => {
        await commit();
        const bin = await mkdtemp(join(tmpdir(), "git-stats-bin-"));
        const log = join(bin, "calls");
        const real = (await run("/bin/sh", ["-c", "command -v git"])).stdout.trim();
        // A stand-in `git` on PATH that records its arguments and then does the real work.
        await writeFile(
            join(bin, "git"),
            `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`,
        );
        await chmod(join(bin, "git"), 0o755);
        for (let index = 0; index < 600; index += 1) {
            await writeFile(join(repo, `untracked-${index}`), "one\ntwo\n");
        }
        const path = process.env["PATH"];
        process.env["PATH"] = bin;
        try {
            assert.equal((await stats())?.added, 1200);
        } finally {
            process.env["PATH"] = path;
        }
        const calls = (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
        await rm(bin, { recursive: true, force: true });
        assert.deepEqual(
            calls.filter((line) => line.includes("--no-index")),
            [],
        );
        assert.ok(calls.some((line) => line.startsWith("ls-files")));
    });
    void it("counts divergence and safely pushes only to a temporary local remote", async () => {
        const remote = join(dir, "remote.git");
        const other = join(dir, "other");
        await git(dir, "init", "--bare", remote);
        await commit();
        await git(repo, "remote", "add", "origin", remote);
        await git(repo, "push", "-u", "origin", "main");
        await commit();
        assert.equal((await stats())?.ahead, 1);
        await call("push");
        assert.equal((await stats())?.ahead, 0);
        await git(dir, "clone", "--branch", "main", remote, other);
        await writeFile(join(other, "remote-file"), "remote\n");
        await commit(other);
        await git(other, "push");
        await git(repo, "fetch");
        assert.equal((await stats())?.behind, 1);
        await assert.rejects(call("push"), /behind/);
        await writeFile(join(repo, "local-file"), "local\n");
        await commit();
        assert.equal((await stats())?.ahead, 1);
        assert.equal((await stats())?.behind, 1);
        await assert.rejects(call("push"), /behind/);
    });
    void it("rejects pushing without an upstream or unpushed commits", async () => {
        await assert.rejects(call("push", null), /Open a session/);
        await commit();
        await assert.rejects(call("push"), /No upstream/);
        const remote = join(dir, "remote.git");
        await git(dir, "init", "--bare", remote);
        await git(repo, "remote", "add", "origin", remote);
        await git(repo, "push", "-u", "origin", "main");
        await assert.rejects(call("push"), /No commits/);
    });
});
