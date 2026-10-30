import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { actions } from "./server.ts";

const run = promisify(execFile);

void describe("git-branch branch action", () => {
    let dir: string;

    const branch = (cwd: string | null) => {
        const action = actions["branch"];

        assert.ok(action);

        return action({ args: undefined, session: { id: 1, cwd } });
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-branch-test-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const commit = (cwd: string) =>
        run(
            "git",
            [
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "x",
            ],
            { cwd },
        );

    void it("gives the branch of a git folder, and no worktree for the main checkout", async () => {
        await run("git", ["init", "-b", "topic"], { cwd: dir });
        await commit(dir);

        assert.deepEqual(await branch(dir), { branch: "topic", worktree: null });
    });

    void it("names the worktree of a linked checkout, from inside it too", async () => {
        const main = join(dir, "main");
        const linked = join(dir, "side-work");

        await run("git", ["init", "-b", "topic", main]);
        await commit(main);
        await run("git", ["worktree", "add", "-b", "other", linked], { cwd: main });
        await mkdir(join(linked, "deep"));

        assert.deepEqual(await branch(linked), { branch: "other", worktree: "side-work" });
        assert.deepEqual(await branch(join(linked, "deep")), {
            branch: "other",
            worktree: "side-work",
        });
        assert.deepEqual(await branch(main), { branch: "topic", worktree: null });
    });

    void it("gives null for a folder without git", async () => {
        assert.equal(await branch(dir), null);
    });

    void it("gives null without a session folder", async () => {
        assert.equal(await branch(null), null);
    });

    void it("names the branch of a repository that has no commit yet", async () => {
        await run("git", ["init", "-b", "unborn"], { cwd: dir });

        assert.deepEqual(await branch(dir), { branch: "unborn", worktree: null });
    });

    void it("names a detached head HEAD", async () => {
        await run("git", ["init", "-b", "topic"], { cwd: dir });
        await commit(dir);
        await run("git", ["checkout", "--detach"], { cwd: dir });

        assert.deepEqual(await branch(dir), { branch: "HEAD", worktree: null });
    });
});
