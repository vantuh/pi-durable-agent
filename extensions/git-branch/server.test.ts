import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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

    void it("gives the branch of a git folder", async () => {
        await run("git", ["init", "-b", "topic"], { cwd: dir });
        await run(
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
            { cwd: dir },
        );

        assert.equal(await branch(dir), "topic");
    });

    void it("gives null for a folder without git", async () => {
        assert.equal(await branch(dir), null);
    });

    void it("gives null without a session folder", async () => {
        assert.equal(await branch(null), null);
    });
});
