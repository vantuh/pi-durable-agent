import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { git, run } from "../../test/fixtures/git.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { actions } from "./server.ts";

void describe("git-branch branch action", () => {
    let dir: string;

    const branch = (cwd: string | null) => {
        const action = actions(testHost())["branch"];

        assert.ok(action);

        return action({ args: undefined, session: { id: 1, cwd } });
    };

    const call = async (name: string, args: unknown, host = testHost(), cwd = dir) => {
        const action = actions(host)[name];

        assert.ok(action);

        return await action({ args, session: { id: 1, cwd } });
    };

    const head = async (cwd = dir): Promise<string> =>
        (await run("git", ["rev-parse", "--verify", "HEAD"], { cwd })).stdout.trim();

    const named = async (ref: string, cwd = dir): Promise<boolean> =>
        run("git", ["rev-parse", "--verify", "--quiet", ref], { cwd }).then(
            () => true,
            () => false,
        );

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-branch-test-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const commit = (cwd: string) => git(cwd, ["commit", "--allow-empty", "-m", "x"]);

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
        beforeEach(async () => {
            await run("git", ["init", "-b", "topic"], { cwd: dir });
            await commit(dir);
            await run("git", ["branch", "other"], { cwd: dir });
        });

        void it("lists the local branches", async () => {
            assert.deepEqual(await call("branches", undefined), [
                { name: "other", worktree: null },
                { name: "topic", worktree: null },
            ]);
        });

        void it("switches to a local branch", async () => {
            assert.deepEqual(await call("checkout", { branch: "other" }), {
                branch: "other",
                worktree: null,
            });
            assert.deepEqual(await branch(dir), { branch: "other" });
        });

        void it("lists the branches of a repository whose folder ends in a space", async () => {
            const root = join(dir, "root ");

            await mkdir(root);
            await run("git", ["init", "-b", "spaced"], { cwd: root });
            await commit(root);

            assert.deepEqual(await call("branches", undefined, testHost(), root), [
                { name: "spaced", worktree: null },
            ]);
        });

        void it("refuses a name that is not a local branch, an option included", async () => {
            await assert.rejects(call("checkout", { branch: "nope" }));
            await assert.rejects(call("checkout", { branch: "--detach" }));
            assert.deepEqual(await branch(dir), { branch: "topic" });
        });

        void it("does not switch while the session is working", async () => {
            const host = testHost({ sessionWorking: () => Promise.resolve(true) });

            await assert.rejects(call("checkout", { branch: "other" }, host));
            assert.deepEqual(await branch(dir), { branch: "topic" });
        });

        void describe("with a worktree", () => {
            let linked: string;

            beforeEach(async () => {
                linked = join(dir, "linked");
                await run("git", ["worktree", "add", linked, "other"], { cwd: dir });
            });

            void it("says where another worktree has a branch", async () => {
                const found = await call("branches", undefined);

                assert.ok(Array.isArray(found));
                assert.deepEqual(
                    found.map((each) => each.name),
                    ["other", "topic"],
                );
                assert.equal(await realpath(found[0].worktree), await realpath(linked));
                assert.equal(found[1].worktree, null);
            });

            void it("moves the session to the worktree that has the branch", async () => {
                const moves: string[] = [];
                const host = testHost({
                    setSessionCwd: (_session, cwd) => {
                        moves.push(cwd);

                        return Promise.resolve();
                    },
                });

                assert.deepEqual(await call("checkout", { branch: "other" }, host), {
                    branch: "other",
                    worktree: await realpath(linked),
                });
                const [moved] = moves;

                assert.equal(moves.length, 1);
                assert.ok(moved);
                assert.equal(await realpath(moved), await realpath(linked));
                assert.deepEqual(await branch(dir), { branch: "topic" });
            });

            void it("keeps a worktree folder whose name has a newline", async () => {
                const odd = join(dir, "odd\nname");

                await run("git", ["worktree", "add", "-b", "odd", odd], { cwd: dir });

                const found = await call("branches", undefined);
                const entry = Array.isArray(found)
                    ? found.find((each) => each.name === "odd")
                    : undefined;

                assert.ok(entry?.worktree);
                assert.equal(await realpath(entry.worktree), await realpath(odd));
            });

            void it("offers no move to a worktree whose folder is gone", async () => {
                const moves: string[] = [];
                const host = testHost({
                    setSessionCwd: (_session, cwd) => {
                        moves.push(cwd);

                        return Promise.resolve();
                    },
                });

                await rm(linked, { recursive: true, force: true });

                const found = await call("branches", undefined);

                assert.ok(Array.isArray(found));
                assert.equal(found.find((each) => each.name === "other")?.worktree, null);
                // Git decides what to do with a branch it still lists; the session does not move.
                await call("checkout", { branch: "other" }, host).catch(() => undefined);
                assert.deepEqual(moves, []);
            });

            void it("switches in place for a branch that no other worktree has", async () => {
                const moves: string[] = [];
                const host = testHost({
                    setSessionCwd: (_session, cwd) => {
                        moves.push(cwd);

                        return Promise.resolve();
                    },
                });

                await run("git", ["branch", "free"], { cwd: dir });
                await call("checkout", { branch: "free" }, host);

                assert.deepEqual(moves, []);
                assert.deepEqual(await branch(dir), { branch: "free" });
            });
        });
    });

    void describe("creating", () => {
        beforeEach(async () => {
            await run("git", ["init", "-b", "topic"], { cwd: dir });
            await commit(dir);
            await run("git", ["branch", "other"], { cwd: dir });
        });

        void it("creates the branch at the current commit and switches to it", async () => {
            const before = await head();

            assert.deepEqual(await call("create", { branch: "feature/slash" }), {
                branch: "feature/slash",
            });
            assert.deepEqual(await branch(dir), { branch: "feature/slash" });
            assert.equal(await head(), before);
        });

        void it("says the session changed", async () => {
            const changed: number[] = [];
            const host = testHost({
                notifySessionChanged: (session) => {
                    changed.push(session);
                },
            });

            await call("create", { branch: "feature" }, host);

            assert.deepEqual(changed, [1]);
        });

        void it("refuses a name git would refuse, and creates nothing", async () => {
            for (const name of ["", "-x", "--detach", "a..b", "a b", "HEAD", "x.lock"]) {
                const refused = await call("create", { branch: name }).then(
                    () => false,
                    () => true,
                );

                assert.equal(refused, true, JSON.stringify(name));
            }

            await assert.rejects(call("create", undefined));
            await assert.rejects(call("create", { branch: 7 }));
            assert.deepEqual(await branch(dir), { branch: "topic" });
            assert.equal(await named("refs/heads/HEAD"), false);
        });

        void it("refuses a history shorthand instead of resolving it", async () => {
            await run("git", ["switch", "-c", "prev"], { cwd: dir });
            await run("git", ["switch", "topic"], { cwd: dir });

            await assert.rejects(call("create", { branch: "@{-1}" }), /not a valid branch name/);
            assert.deepEqual(await branch(dir), { branch: "topic" });
        });

        void it("leaves an existing branch as it is", async () => {
            await run("git", ["switch", "other"], { cwd: dir });
            await commit(dir);
            const tip = await head();

            await run("git", ["switch", "topic"], { cwd: dir });
            await assert.rejects(call("create", { branch: "other" }), /already exists/);

            assert.deepEqual(await branch(dir), { branch: "topic" });
            assert.equal(
                (await run("git", ["rev-parse", "other"], { cwd: dir })).stdout.trim(),
                tip,
            );
        });

        void it("does not create while the session is working", async () => {
            const host = testHost({ sessionWorking: () => Promise.resolve(true) });

            await assert.rejects(call("create", { branch: "feature" }, host));
            assert.deepEqual(await branch(dir), { branch: "topic" });
            assert.equal(await named("refs/heads/feature"), false);
        });

        void it("keeps uncommitted work", async () => {
            await writeFile(join(dir, "note.txt"), "one\n");
            await run("git", ["add", "note.txt"], { cwd: dir });
            await commit(dir);
            await writeFile(join(dir, "note.txt"), "two\n");
            await writeFile(join(dir, "fresh.txt"), "new\n");

            await call("create", { branch: "feature" });

            assert.equal(await readFile(join(dir, "note.txt"), "utf8"), "two\n");
            assert.equal(await readFile(join(dir, "fresh.txt"), "utf8"), "new\n");
            assert.deepEqual(await branch(dir), { branch: "feature" });
        });

        void it("says why git refused, and stays where it was", async () => {
            await run("git", ["branch", "a"], { cwd: dir });

            // `refs/heads/a` is a file, so the folder `a/b` needs cannot be made.
            await assert.rejects(
                call("create", { branch: "a/b" }),
                /cannot lock ref|cannot create/,
            );
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
