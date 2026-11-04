import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { testHost } from "../../test/fixtures/host.ts";
import { actions } from "./server.ts";

const run = promisify(execFile);

void describe("git-branch branch action", () => {
    let dir: string;

    const branch = (cwd: string | null) => {
        const action = actions(testHost())["branch"];

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

    void it("gives the branch of a git folder", async () => {
        await run("git", ["init", "-b", "topic"], { cwd: dir });
        await commit(dir);

        assert.deepEqual(await branch(dir), { branch: "topic" });
    });

    void it("gives the branch of a linked worktree, from inside it too", async () => {
        const main = join(dir, "main");
        const linked = join(dir, "side-work");

        await run("git", ["init", "-b", "topic", main]);
        await commit(main);
        await run("git", ["worktree", "add", "-b", "other", linked], { cwd: main });
        await mkdir(join(linked, "deep"));

        assert.deepEqual(await branch(linked), { branch: "other" });
        assert.deepEqual(await branch(join(linked, "deep")), { branch: "other" });
        assert.deepEqual(await branch(main), { branch: "topic" });
    });

    void it("gives null for a folder without git", async () => {
        assert.equal(await branch(dir), null);
    });

    void it("gives null without a session folder", async () => {
        assert.equal(await branch(null), null);
    });

    void it("names the branch of a repository that has no commit yet", async () => {
        await run("git", ["init", "-b", "unborn"], { cwd: dir });

        assert.deepEqual(await branch(dir), { branch: "unborn" });
    });

    void describe("switching", () => {
        const call = async (name: string, args: unknown) => {
            const action = actions(testHost())[name];

            assert.ok(action);

            return await action({ args, session: { id: 1, cwd: dir } });
        };

        beforeEach(async () => {
            await run("git", ["init", "-b", "topic"], { cwd: dir });
            await commit(dir);
            await run("git", ["branch", "other"], { cwd: dir });
        });

        void it("lists the local branches", async () => {
            assert.deepEqual(await call("branches", undefined), ["other", "topic"]);
        });

        void it("switches to a local branch", async () => {
            assert.deepEqual(await call("checkout", { branch: "other" }), { branch: "other" });
            assert.deepEqual(await branch(dir), { branch: "other" });
        });

        void it("refuses a name that is not a local branch, an option included", async () => {
            await assert.rejects(call("checkout", { branch: "nope" }));
            await assert.rejects(call("checkout", { branch: "--detach" }));
            assert.deepEqual(await branch(dir), { branch: "topic" });
        });
    });

    void it("names a detached head HEAD", async () => {
        await run("git", ["init", "-b", "topic"], { cwd: dir });
        await commit(dir);
        await run("git", ["checkout", "--detach"], { cwd: dir });

        assert.deepEqual(await branch(dir), { branch: "HEAD" });
    });
});
