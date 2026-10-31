import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { makeWorktree, slugOf } from "./worktree.ts";

const run = promisify(execFile);

void describe("git-worktree", () => {
    let dir: string;
    let repo: string;
    let data: string;

    const git = (cwd: string, args: string[]) =>
        run(
            "git",
            ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
            { cwd },
        );

    const branch = async (cwd: string): Promise<string> =>
        (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();

    /** A repository with one commit holding `file`, and no other. */
    const init = async (): Promise<void> => {
        await run("git", ["init", "-b", "main", repo]);
        await git(repo, ["config", "user.name", "t"]);
        await git(repo, ["config", "user.email", "t@t"]);
        await git(repo, ["config", "commit.gpgsign", "false"]);
        await writeFile(join(repo, "file"), "first\n");
        await git(repo, ["add", "file"]);
        await git(repo, ["commit", "-m", "first"]);
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-worktree-test-"));
        repo = join(dir, "repo");
        data = join(dir, "data");
        await mkdir(repo);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("makes a worktree on a branch of its own, with the last commit in it", async () => {
        await init();

        const made = await makeWorktree(data, repo, "Fix Auth");

        assert.equal(made.branch, "fix-auth");
        assert.equal(made.worktree, join(data, "worktrees", "repo", "fix-auth"));
        assert.equal(made.path, made.worktree);
        assert.equal(await readFile(join(made.path, "file"), "utf8"), "first\n");
        assert.equal(await branch(made.path), "fix-auth");
        // The folder it came from is still on its own branch.
        assert.equal(await branch(repo), "main");
    });

    void it("brings the commits that are not pushed anywhere yet", async () => {
        await init();
        const remote = join(dir, "remote");

        await run("git", ["init", "-q", "--bare", remote]);
        await git(repo, ["remote", "add", "origin", remote]);
        await git(repo, ["push", "-q", "origin", "main"]);
        await writeFile(join(repo, "local.txt"), "not pushed\n");
        await git(repo, ["add", "local.txt"]);
        await git(repo, ["commit", "-qm", "local work"]);

        const made = await makeWorktree(data, repo, "unpushed");

        assert.equal(await readFile(join(made.path, "local.txt"), "utf8"), "not pushed\n");
        assert.equal(
            (await git(made.path, ["log", "--oneline", "origin/main..HEAD"])).stdout
                .trim()
                .split("\n").length,
            1,
        );
    });

    void it("starts clean: the folder's uncommitted work stays out of it", async () => {
        await init();
        await writeFile(join(repo, "file"), "changed\n");
        await writeFile(join(repo, "new"), "made\n");

        const made = await makeWorktree(data, repo, "clean");

        assert.equal(await readFile(join(made.path, "file"), "utf8"), "first\n");
        await assert.rejects(readFile(join(made.path, "new"), "utf8"));
    });

    void it("starts from the branch the folder is on", async () => {
        await init();
        await git(repo, ["checkout", "-qb", "feature"]);
        await writeFile(join(repo, "feature.txt"), "work\n");
        await git(repo, ["add", "feature.txt"]);
        await git(repo, ["commit", "-qm", "feature"]);

        const made = await makeWorktree(data, repo, "from-feature");

        assert.equal(await readFile(join(made.path, "feature.txt"), "utf8"), "work\n");
        assert.equal(await branch(repo), "feature");
    });

    void it("starts in the matching folder of a session inside the repository", async () => {
        await init();
        await mkdir(join(repo, "packages", "app"), { recursive: true });

        const made = await makeWorktree(data, join(repo, "packages", "app"), "deep");

        assert.equal(made.path, join(data, "worktrees", "repo", "deep", "packages", "app"));
    });

    void it("names the folder after the repository, also from inside a worktree it made", async () => {
        await init();
        const first = await makeWorktree(data, repo, "first");

        const second = await makeWorktree(data, first.path, "second");

        assert.equal(second.worktree, join(data, "worktrees", "repo", "second"));
    });

    void it("refuses a folder that is in no repository", async () => {
        const plain = join(dir, "plain");

        await mkdir(plain);
        await assert.rejects(makeWorktree(data, plain, "x"), /is not in a git repository/);
    });

    void it("refuses a repository with no commit yet", async () => {
        await run("git", ["init", "-b", "main", repo]);

        await assert.rejects(makeWorktree(data, repo, "x"), /has no commits yet/);
    });

    void it("refuses a name it already made a worktree for", async () => {
        await init();
        await makeWorktree(data, repo, "twice");

        await assert.rejects(makeWorktree(data, repo, "twice"), /already a worktree named twice/);
    });

    void it("refuses a name that gives no branch", async () => {
        await init();

        await assert.rejects(makeWorktree(data, repo, "  !!! "), /Name the worktree/);
    });

    void it("refuses a name that is a branch already", async () => {
        await init();
        await git(repo, ["branch", "taken"]);

        await assert.rejects(makeWorktree(data, repo, "taken"), /already has a branch named taken/);
    });
});

void describe("git-worktree slugOf", () => {
    void it("gives what git takes as a branch name", () => {
        assert.equal(slugOf("Fix Auth"), "fix-auth");
        assert.equal(slugOf("  feature/login  "), "feature-login");
        assert.equal(slugOf("v2.1_hot-fix"), "v2.1_hot-fix");
        assert.equal(slugOf("!!!"), "");
        assert.equal(slugOf("x".repeat(60)).length, 40);
    });
});
