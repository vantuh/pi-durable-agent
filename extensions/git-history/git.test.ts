import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { parsePatchFiles } from "@pierre/diffs";

import { filesOf, git, readChanges, readHistory } from "./git.ts";

void describe("git-history reads", () => {
    let dir: string;
    let repo: string;
    const commit = async (cwd = repo, message = "test") => {
        await git(cwd, ["add", "."]);
        await git(cwd, [
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            message,
        ]);
        return (await git(cwd, ["rev-parse", "HEAD"])).trim();
    };
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-history-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git(repo, ["init", "-b", "main"]);
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });
    void it("supports an unborn branch, staged + unstaged and untracked changes", async () => {
        await writeFile(join(repo, "file"), "a\nb\n");
        await git(repo, ["add", "."]);
        await writeFile(join(repo, "file"), "a\n");
        await writeFile(join(repo, "new\tfile\nname"), "new\n");
        assert.equal((await readHistory(repo, 50)).commits.length, 0);
        assert.equal((await readHistory(repo, 50)).changes, 2);
        const diff = await readChanges(repo, "worktree");
        assert.equal(
            diff.files.reduce((sum, file) => sum + file.added, 0),
            2,
        );
        assert.match(diff.patch, /\+a/);
        assert.equal(diff.truncated, false);
    });
    void it("reads root commits, pagination and nested session folders", async () => {
        await writeFile(join(repo, "file"), "first\n");
        const root = await commit(repo, "root commit");
        const diff = await readChanges(repo, root);
        assert.equal(diff.title, "root commit");
        assert.equal(diff.files[0]?.added, 1);
        await commit(repo, "second");
        await mkdir(join(repo, "nested"));
        const log = await readHistory(join(repo, "nested"), 1);
        assert.equal(log.commits.length, 1);
        assert.equal(log.commits[0]?.subject, "second");
        assert.equal(log.commits[0]?.body, "");
        await writeFile(join(repo, "file"), "third\n");
        const described = await commit(repo, "third\n\nthe description");
        const full = await readHistory(repo, 1);
        assert.equal(full.commits[0]?.hash, described);
        assert.equal(full.commits[0]?.subject, "third");
        assert.equal(full.commits[0]?.body, "the description");
        assert.equal(log.more, true);
        await assert.rejects(readHistory(dir, 50), /not a Git/);
        await assert.rejects(readChanges(repo, "--output=bad"), /Choose a commit/);
    });
    void it("compares merges to the first parent without checking out anything", async () => {
        await commit();
        await git(repo, ["checkout", "-b", "side"]);
        await writeFile(join(repo, "side-file"), "side\n");
        await commit();
        await git(repo, ["checkout", "main"]);
        await writeFile(join(repo, "main-file"), "main\n");
        await commit();
        await git(repo, [
            "-c",
            "user.name=Test",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "merge",
            "--no-ff",
            "side",
            "-m",
            "merge",
        ]);
        const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
        assert.deepEqual(
            (await readChanges(repo, head)).files.map((file) => file.path),
            ["side-file"],
        );
        assert.equal((await git(repo, ["symbolic-ref", "--short", "HEAD"])).trim(), "main");
    });
    void it("marks actual upstream membership and incoming commits", async () => {
        const remote = join(dir, "remote.git");
        await git(dir, ["init", "--bare", remote]);
        await writeFile(join(repo, "file"), "base\n");
        await commit();
        await git(repo, ["remote", "add", "origin", remote]);
        await git(repo, ["push", "-u", "origin", "main"]);
        const local = await commit(repo, "local");
        const other = join(dir, "other");
        await git(dir, ["clone", "--branch", "main", remote, other]);
        await writeFile(join(other, "remote-file"), "remote\n");
        const incoming = await commit(other, "incoming");
        await git(other, ["push"]);
        await git(repo, ["fetch"]);
        const log = await readHistory(repo, 50);
        assert.equal(log.ahead, 1);
        assert.equal(log.behind, 1);
        assert.equal(log.commits.find((c) => c.hash === local)?.unpushed, true);
        assert.equal(log.commits.find((c) => c.hash === incoming)?.remote, true);
        assert.equal(log.commits.filter((c) => c.unpushed).length, 1);
    });
    void it("bounds previews and never follows an untracked symlink outside the checkout", async () => {
        await commit();
        await writeFile(join(repo, "large"), "x\n".repeat(1000));
        await writeFile(join(dir, "secret"), "OUTSIDE SECRET\n");
        await symlink(join(dir, "secret"), join(repo, "link"));
        const diff = await readChanges(repo, "worktree", 100);
        assert.equal(diff.truncated, true);
        assert.doesNotMatch(diff.patch, /OUTSIDE SECRET/);
        assert.deepEqual(diff.files.map((f) => f.path).sort(), ["large", "link"]);
    });
    void it("matches Pierre file names to Git stats for commits and the working tree", async () => {
        await writeFile(join(repo, "before.ts"), "export const value = 1;\n");
        await writeFile(join(repo, "removed"), "gone\n");
        await writeFile(join(repo, "executable"), "run\n");
        await commit();
        const renamed = 'renamed\t"file"\n.ts';
        await git(repo, ["mv", "before.ts", renamed]);
        await git(repo, ["rm", "removed"]);
        await chmod(join(repo, "executable"), 0o755);
        await writeFile(join(repo, "binary"), Buffer.from([0, 1, 2]));
        await writeFile(join(repo, "new.ts"), "export const added = true;\n");
        const working = await readChanges(repo, "worktree");
        const committed = await readChanges(repo, await commit());
        for (const data of [working, committed]) {
            const files = parsePatchFiles(data.patch, undefined, true).flatMap(
                (patch) => patch.files,
            );
            assert.deepEqual(
                files.map((file) => file.name).sort(),
                data.files.map((file) => file.path).sort(),
            );
            assert.equal(files.find((file) => file.name === renamed)?.prevName, "before.ts");
            assert.equal(files.find((file) => file.name === "executable")?.hunks.length, 0);
            assert.equal(data.files.find((file) => file.path === "binary")?.binary, true);
            assert.equal(
                files.find((file) => file.name === "new.ts")?.additionLines.join(""),
                "export const added = true;\n",
            );
            assert.equal(files.find((file) => file.name === "removed")?.type, "deleted");
        }
    });
    void it("parses binary and renamed numstat records with unusual paths", () => {
        assert.deepEqual(filesOf("-\t-\tbinary\0"), [
            { path: "binary", added: 0, deleted: 0, binary: true },
        ]);
        assert.deepEqual(filesOf("1\t2\t\0old\0new\tpath\n\0"), [
            { path: "new\tpath\n", added: 1, deleted: 2, binary: false },
        ]);
    });
});
