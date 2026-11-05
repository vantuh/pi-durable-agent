import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { testHost } from "../../test/fixtures/host.ts";
import { actions } from "./server.ts";
import { makeWorktree } from "./worktree.ts";

const run = promisify(execFile);

void describe("git-worktree actions", () => {
    let dir: string;
    let repo: string;
    let data: string;
    /** Every folder the last action call moved the session to, in order. */
    let moved: [number, string][];
    /** Every session the last action call said changed, in order. */
    let changed: number[];

    const git = (cwd: string, args: string[]) =>
        run(
            "git",
            ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
            { cwd },
        );

    const head = async (cwd: string): Promise<string> =>
        (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();

    /**
     * One action call from a session in `cwd`, with a host that records what it was asked to do.
     * `working` is its answer to `sessionWorking`: one answer for every call, or one per call in turn.
     */
    const call = async (
        name: string,
        args: unknown,
        cwd: string | null,
        working: boolean | boolean[] = false,
    ) => {
        const answers = Array.isArray(working) ? [...working] : null;
        const action = actions(
            testHost({
                dataDir: data,
                sessionWorking: () => Promise.resolve(answers?.shift() ?? working === true),
                setSessionCwd: (id, folder) => {
                    moved.push([id, folder]);

                    return Promise.resolve();
                },
                notifySessionChanged: (id) => {
                    changed.push(id);
                },
            }),
        )[name];

        assert.ok(action);
        moved = [];
        changed = [];

        return await action({ args, session: cwd === null ? null : { id: 7, cwd } });
    };

    /** A repository with one commit holding `file`, and no other. */
    const init = async (): Promise<void> => {
        await run("git", ["init", "-q", "-b", "main", repo]);
        await writeFile(join(repo, "file"), "first\n");
        await git(repo, ["add", "file"]);
        await git(repo, ["commit", "-qm", "first"]);
    };

    /** A linked worktree of the repository, made by hand, as its own folder's real path. */
    const linked = async (): Promise<string> => {
        const theirs = join(dir, "theirs");

        await git(repo, ["worktree", "add", "-q", "-b", "theirs", theirs]);

        return await realpath(theirs);
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-worktree-actions-"));
        repo = join(dir, "repo");
        data = join(dir, "data");
        moved = [];
        changed = [];
        await mkdir(repo);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void describe("state", () => {
        void it("names the main checkout of a repository, with nothing to remove from it", async () => {
            await init();

            assert.deepEqual(await call("state", { cwd: join(repo) }, repo), {
                name: "Main checkout",
                folder: await realpath(repo),
                gone: false,
                main: true,
                ours: false,
            });
        });

        void it("names a worktree of this server, and a linked one made elsewhere", async () => {
            await init();
            const ours = await makeWorktree(data, repo, "ours");
            const theirs = await linked();

            assert.deepEqual(await call("state", { cwd: ours.path }, ours.path), {
                name: "ours",
                folder: ours.worktree,
                gone: false,
                main: false,
                ours: true,
            });
            assert.deepEqual(await call("state", { cwd: theirs }, theirs), {
                name: "theirs",
                folder: theirs,
                gone: false,
                main: false,
                ours: false,
            });
        });

        void it("answers nothing for a folder outside git", async () => {
            const plain = join(dir, "plain");

            await mkdir(plain);

            assert.equal(await call("state", { cwd: plain }, plain), null);
        });
    });

    void describe("move", () => {
        void it("moves the session to an existing worktree, and says the rest of the app changed", async () => {
            await init();
            const theirs = await linked();

            assert.deepEqual(await call("move", { worktree: theirs }, repo), {
                moved: true,
                path: theirs,
            });
            assert.deepEqual(moved, [[7, theirs]]);
            assert.deepEqual(changed, [7]);
        });

        void it("keeps the session's place inside a worktree it moves to", async () => {
            await init();
            await mkdir(join(repo, "packages", "app"), { recursive: true });
            await writeFile(join(repo, "packages", "app", "file"), "deep\n");
            await git(repo, ["add", "packages"]);
            await git(repo, ["commit", "-qm", "deep"]);
            const theirs = await linked();

            assert.deepEqual(
                await call("move", { worktree: theirs }, join(repo, "packages", "app")),
                { moved: true, path: join(theirs, "packages", "app") },
            );
        });

        void it("moves the session back to the main checkout from a worktree", async () => {
            await init();
            const ours = await makeWorktree(data, repo, "ours");

            assert.deepEqual(await call("move", { worktree: await realpath(repo) }, ours.path), {
                moved: true,
                path: await realpath(repo),
            });
            assert.deepEqual(moved, [[7, await realpath(repo)]]);
        });

        void it("does not move a session already in that worktree, and says where it is", async () => {
            await init();
            const ours = await makeWorktree(data, repo, "ours");

            assert.deepEqual(
                await call("move", { worktree: await realpath(ours.worktree) }, ours.path),
                { moved: false, path: ours.path },
            );
            assert.deepEqual(moved, []);
            assert.deepEqual(changed, [7]);
        });

        void it("refuses a folder of another repository, and one no worktree is in", async () => {
            await init();
            const other = join(dir, "other");

            await run("git", ["init", "-q", "-b", "main", other]);
            await git(other, ["commit", "-q", "--allow-empty", "-m", "first"]);
            await linked();

            await assert.rejects(
                call("move", { worktree: await realpath(other) }, repo),
                /must be a worktree of the session's repository/,
            );
            await assert.rejects(
                call("move", { worktree: "/nope/at/all" }, repo),
                /must be a worktree of the session's repository/,
            );
            assert.deepEqual(moved, []);
        });

        void it("refuses a session with no folder, and no session at all", async () => {
            await init();

            await assert.rejects(
                call("move", { worktree: await realpath(repo) }, null),
                /a session with a folder is needed/,
            );
            assert.deepEqual(moved, []);
        });

        void it("refuses when the agent starts while the worktrees are listed, and moves nothing", async () => {
            await init();
            const theirs = await linked();

            await assert.rejects(
                // Not working when the call begins, working once git has answered.
                call("move", { worktree: theirs }, repo, [false, true]),
                /the agent is working/,
            );
            assert.deepEqual(moved, []);
            assert.deepEqual(changed, []);
        });

        void it("refuses while the agent is working, and moves nothing", async () => {
            await init();
            const theirs = await linked();

            await assert.rejects(
                call("move", { worktree: theirs }, repo, true),
                /the agent is working/,
            );
            assert.deepEqual(moved, []);
            assert.deepEqual(changed, []);
        });
    });

    void describe("create", () => {
        void it("makes a worktree at the current commit and moves the session into it at once", async () => {
            await init();
            await writeFile(join(repo, "file"), "uncommitted\n");
            await writeFile(join(repo, "new"), "uncommitted\n");
            const made = join(data, "worktrees", "repo", "fix-auth");

            assert.deepEqual(await call("create", { name: "Fix Auth" }, repo), {
                moved: true,
                path: made,
            });
            assert.deepEqual(moved, [[7, made]]);
            assert.deepEqual(changed, [7]);
            // The commit comes along; the uncommitted work stays where it was.
            assert.equal(await readFile(join(made, "file"), "utf8"), "first\n");
            assert.equal(existsSync(join(made, "new")), false);
            assert.equal(await readFile(join(repo, "file"), "utf8"), "uncommitted\n");
            assert.equal(await head(made), await head(repo));
        });

        void it("starts in the worktree's root when the matching folder is not in it", async () => {
            await init();
            await mkdir(join(repo, "loose"));
            const made = join(data, "worktrees", "repo", "loose");

            assert.deepEqual(await call("create", { name: "loose" }, join(repo, "loose")), {
                moved: true,
                path: made,
            });
            assert.equal(existsSync(made), true);
        });

        void it("refuses a name it already used, and leaves the session where it was", async () => {
            await init();
            await makeWorktree(data, repo, "twice");

            await assert.rejects(
                call("create", { name: "twice" }, repo),
                /already a worktree named twice/,
            );
            assert.deepEqual(moved, []);
            assert.deepEqual(changed, []);
        });

        void it("refuses while the agent is working, and makes nothing", async () => {
            await init();

            await assert.rejects(
                call("create", { name: "later" }, repo, true),
                /the agent is working/,
            );
            assert.deepEqual(moved, []);
            assert.equal(existsSync(join(data, "worktrees", "repo", "later")), false);
        });
    });
});
