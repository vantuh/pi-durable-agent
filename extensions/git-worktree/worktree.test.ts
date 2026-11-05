import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { slugOf } from "./refs.ts";
import { mainOfRemembered } from "./remembered.ts";
import {
    groupOf,
    linkedWorktreeOf,
    mainCheckoutOf,
    makeWorktree,
    removeWorktree,
    worktreeOf,
    worktreesAmong,
    worktreesOf,
} from "./worktree.ts";

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

    void it("removes the folder of a worktree and keeps its branch, and its commits", async () => {
        await init();
        const made = await makeWorktree(data, repo, "try-it");

        await writeFile(join(made.path, "file"), "second\n");
        await git(made.path, ["commit", "-am", "second"]);

        assert.deepEqual(await removeWorktree(data, made.path), { removed: made.worktree });
        assert.equal(existsSync(made.worktree), false);
        assert.ok(!(await git(repo, ["worktree", "list"])).stdout.includes("try-it"));
        assert.ok((await git(repo, ["branch", "--list", "try-it"])).stdout.includes("try-it"));
        assert.match((await git(repo, ["log", "--oneline", "try-it"])).stdout, /second/);
    });

    void it("refuses to remove a worktree git would lose changes from, and keeps it", async () => {
        await init();
        const made = await makeWorktree(data, repo, "busy");

        await writeFile(join(made.path, "new.txt"), "not committed\n");

        await assert.rejects(removeWorktree(data, made.path), /modified or untracked files/);
        assert.ok(existsSync(join(made.path, "new.txt")));
    });

    void it("refuses a folder that is no worktree of this server", async () => {
        await init();

        await assert.rejects(removeWorktree(data, repo), /does not work in a worktree/);
    });

    void it("refuses a worktree that is not there any more", async () => {
        await init();
        const made = await makeWorktree(data, repo, "gone");

        await rm(made.worktree, { recursive: true, force: true });

        await assert.rejects(removeWorktree(data, made.path), /not there any more/);
    });
});

void describe("git-worktree worktreeOf", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-worktree-of-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("names the worktree of a folder that is one of ours, and says it is there", async () => {
        await mkdir(join(dir, "worktrees", "repo", "try-it", "packages"), { recursive: true });

        const at = join(dir, "worktrees", "repo", "try-it");

        assert.deepEqual(worktreeOf(dir, at), { name: "try-it", folder: at, gone: false });
        assert.deepEqual(worktreeOf(dir, join(at, "packages")), {
            name: "try-it",
            folder: at,
            gone: false,
        });
    });

    void it("says a worktree that is not there any more is gone", () => {
        assert.deepEqual(worktreeOf(dir, join(dir, "worktrees", "repo", "gone-one")), {
            name: "gone-one",
            folder: join(dir, "worktrees", "repo", "gone-one"),
            gone: true,
        });
    });

    void it("knows nothing of a folder that is no worktree of ours", () => {
        assert.equal(worktreeOf(dir, join(dir, "worktrees")), null);
        assert.equal(worktreeOf(dir, join(dir, "worktrees", "repo")), null);
        assert.equal(worktreeOf(dir, join(dir, "worktrees-somewhere", "repo", "x")), null);
        assert.equal(worktreeOf(dir, join(dir, "repo")), null);
        assert.equal(worktreeOf(dir, join(dir, "worktrees", "..", "repo")), null);
    });
});

void describe("git-worktree linkedWorktreeOf", () => {
    void it("names a linked worktree someone else made, and not the main checkout", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-linked-"));

        try {
            const main = join(at, "main");
            const linked = join(at, "side-work");

            await run("git", ["init", "-q", "-b", "main", main]);
            await mkdir(join(linked));
            await run(
                "git",
                [
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "commit",
                    "-q",
                    "--allow-empty",
                    "-m",
                    "x",
                ],
                { cwd: main },
            );
            await run("git", ["worktree", "add", "-q", "-b", "other", linked], { cwd: main });

            // git answers with the path it resolved, and /var is a link to /private/var.
            assert.deepEqual(await linkedWorktreeOf(linked), {
                name: "side-work",
                folder: await realpath(linked),
            });
            assert.equal(await linkedWorktreeOf(main), null);
            assert.equal(await linkedWorktreeOf(join(at, "nothing")), null);
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });
});

void describe("git-worktree mainCheckoutOf", () => {
    void it("answers the repository's folder for a worktree, and nothing for any other folder", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-main-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");
            const git = (cwd: string, args: string[]) =>
                run(
                    "git",
                    [
                        "-c",
                        "user.name=t",
                        "-c",
                        "user.email=t@t",
                        "-c",
                        "commit.gpgsign=false",
                        ...args,
                    ],
                    { cwd },
                );

            await run("git", ["init", "-q", "-b", "main", repo]);
            await git(repo, ["commit", "-q", "--allow-empty", "-m", "first"]);
            await mkdir(join(repo, "src"));

            const made = await makeWorktree(data, repo, "side");

            // git answers with the path it resolved, and /var is a link to /private/var.
            assert.equal(await mainCheckoutOf(made.path), await realpath(repo));
            assert.equal(await mainCheckoutOf(repo), undefined);
            assert.equal(await mainCheckoutOf(join(repo, "src")), undefined);
            assert.equal(await mainCheckoutOf(at), undefined);
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("keeps a worktree of a bare repository linked, and under nobody", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-bare-main-"));

        try {
            const repo = join(at, "repo");
            const outer = join(at, "outer");
            // Inside another repository's root: the folder around it is no checkout of this one.
            const bare = join(outer, "bare.git");
            const linked = join(outer, "outside");
            const git = (cwd: string, args: string[]) =>
                run(
                    "git",
                    [
                        "-c",
                        "user.name=t",
                        "-c",
                        "user.email=t@t",
                        "-c",
                        "commit.gpgsign=false",
                        ...args,
                    ],
                    { cwd },
                );

            await run("git", ["init", "-q", "-b", "main", repo]);
            await git(repo, ["commit", "-q", "--allow-empty", "-m", "first"]);
            await run("git", ["init", "-q", "-b", "main", outer]);
            await git(outer, ["commit", "-q", "--allow-empty", "-m", "outer"]);
            await run("git", ["clone", "-q", "--bare", repo, bare]);
            await git(bare, ["worktree", "add", "-q", "-b", "choice", linked]);

            // A bare repository has no checkout, so the worktree stands under nobody — although the
            // folder around it is a repository of its own.
            assert.equal(await mainCheckoutOf(linked), undefined);
            assert.equal(await groupOf(at, linked), undefined);

            // It is a linked worktree all the same: its badge stays, and the picker keeps offering it,
            // since there is no main checkout to pick instead.
            assert.deepEqual(await linkedWorktreeOf(linked), {
                name: "outside",
                folder: await realpath(linked),
            });
            assert.deepEqual(await worktreesAmong([linked]), [], "and is never left out of a list");
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });
});

void describe("git-worktree groupOf", () => {
    void it("keeps a worktree under its repository once git has forgotten it", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-group-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");
            const git = (cwd: string, args: string[]) =>
                run(
                    "git",
                    [
                        "-c",
                        "user.name=t",
                        "-c",
                        "user.email=t@t",
                        "-c",
                        "commit.gpgsign=false",
                        ...args,
                    ],
                    { cwd },
                );

            await run("git", ["init", "-q", "-b", "main", repo]);
            await git(repo, ["commit", "-q", "--allow-empty", "-m", "first"]);

            const made = await makeWorktree(data, repo, "gone");

            // While it is there, git says which repository it belongs to.
            assert.equal(await groupOf(data, made.worktree), await realpath(repo));

            await git(repo, ["worktree", "remove", "--force", made.worktree]);

            // git has forgotten it; the repository remembered when it was made answers instead.
            assert.equal(await mainCheckoutOf(made.worktree), undefined);
            assert.equal(await groupOf(data, made.worktree), await realpath(repo));
            assert.equal(await groupOf(data, join(made.worktree, "src")), await realpath(repo));
            assert.equal(await groupOf(data, at), undefined);
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("takes the closest remembered worktree for a folder inside one", () => {
        const rows = new Map([
            ["/data/worktrees/repo/one", "/repo"],
            ["/data/worktrees/repo/one/branch", "/other"],
        ]);

        assert.equal(mainOfRemembered(rows, "/data/worktrees/repo/one/branch/src"), "/other");
        assert.equal(mainOfRemembered(rows, "/data/worktrees/repo/one/src"), "/repo");
        assert.equal(mainOfRemembered(rows, "/data/worktrees/repo"), undefined);
        assert.equal(mainOfRemembered(new Map(), "/repo"), undefined);
    });
});

void describe("git-worktree worktreesOf", () => {
    void it("offers the main checkout first, then the worktrees made here and elsewhere", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-choices-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");
            const theirs = join(at, "theirs");
            const git = (cwd: string, args: string[]) =>
                run(
                    "git",
                    [
                        "-c",
                        "user.name=t",
                        "-c",
                        "user.email=t@t",
                        "-c",
                        "commit.gpgsign=false",
                        ...args,
                    ],
                    { cwd },
                );

            await run("git", ["init", "-q", "-b", "main", repo]);
            await mkdir(join(repo, "src"));
            await writeFile(join(repo, "src", "file"), "first\n");
            await git(repo, ["add", "src"]);
            await git(repo, ["commit", "-q", "-m", "first"]);

            const ours = await makeWorktree(data, repo, "ours");

            await mkdir(theirs);
            await git(repo, ["worktree", "add", "-q", "-b", "theirs", theirs]);

            const choices = await worktreesOf(join(repo, "src"));

            // git answers with the paths it resolved, and /var is a link to /private/var; a session in
            // the repository's `src` starts in the `src` of the worktree it is given.
            assert.deepEqual(choices[0], {
                name: "main",
                path: join(await realpath(repo), "src"),
                root: await realpath(repo),
                main: true,
                current: true,
            });
            // git lists them by folder, and the worktrees this server makes sit under its data folder.
            // The root is the worktree's own folder, whatever folder inside it the session starts in.
            assert.deepEqual(
                choices
                    .slice(1)
                    .map((choice) => [choice.name, choice.path, choice.root, choice.main]),
                [
                    [
                        "ours",
                        join(await realpath(ours.worktree), "src"),
                        await realpath(ours.worktree),
                        false,
                    ],
                    ["theirs", join(await realpath(theirs), "src"), await realpath(theirs), false],
                ],
            );

            // The checkout the picked folder is in is the one marked, wherever it is.
            const fromOurs = await worktreesOf(ours.worktree);

            assert.deepEqual(
                fromOurs.filter((choice) => choice.current).map((choice) => choice.name),
                ["ours"],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("names a worktree on no branch after its folder", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-detached-"));

        try {
            const repo = join(at, "repo");
            const fresh = join(at, "fresh-clone");

            await run("git", ["init", "-q", "-b", "main", repo]);
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
                    "-q",
                    "--allow-empty",
                    "-m",
                    "first",
                ],
                { cwd: repo },
            );
            await run("git", ["worktree", "add", "-q", "--detach", fresh], { cwd: repo });

            assert.deepEqual(
                (await worktreesOf(repo)).map((choice) => choice.name),
                ["main", "fresh-clone"],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("lists a worktree whose folder holds a newline", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-newline-"));

        try {
            const repo = join(at, "repo");
            const odd = join(at, "with\nbreak");

            await run("git", ["init", "-q", "-b", "main", repo]);
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
                    "-q",
                    "--allow-empty",
                    "-m",
                    "first",
                ],
                { cwd: repo },
            );
            await run("git", ["worktree", "add", "-q", "-b", "odd", odd], { cwd: repo });

            // The path is one line of git's own output unless it is read as NUL-terminated.
            assert.deepEqual(
                (await worktreesOf(repo)).map((choice) => [choice.name, choice.path]),
                [
                    ["main", await realpath(repo)],
                    ["odd", await realpath(odd)],
                ],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("starts in the worktree's matching folder only while it is a folder", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-file-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");

            await run("git", ["init", "-q", "-b", "main", repo]);
            await mkdir(join(repo, "src"));
            await writeFile(join(repo, "src", "file"), "first\n");
            await run(
                "git",
                [
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "-c",
                    "commit.gpgsign=false",
                    "add",
                    "src",
                ],
                { cwd: repo },
            );
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
                    "-q",
                    "-m",
                    "first",
                ],
                { cwd: repo },
            );

            const made = await makeWorktree(data, repo, "ours");

            // The branch is free to replace the folder with a file: as a session's folder it is no use.
            await rm(join(made.worktree, "src"), { recursive: true, force: true });
            await writeFile(join(made.worktree, "src"), "not a folder\n");

            assert.deepEqual(
                (await worktreesOf(join(repo, "src"))).map((choice) => [choice.name, choice.path]),
                [
                    ["main", join(await realpath(repo), "src")],
                    ["ours", await realpath(made.worktree)],
                ],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("leaves a bare repository out and keeps main on the main checkout", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-bare-"));

        try {
            const repo = join(at, "repo");
            const outer = join(at, "outer");
            // Inside another repository's root: the folder around it is no checkout of this one.
            const bare = join(outer, "bare.git");
            const linked = join(outer, "outside");
            const git = (cwd: string, args: string[]) =>
                run(
                    "git",
                    [
                        "-c",
                        "user.name=t",
                        "-c",
                        "user.email=t@t",
                        "-c",
                        "commit.gpgsign=false",
                        ...args,
                    ],
                    { cwd },
                );

            await run("git", ["init", "-q", "-b", "main", repo]);
            await git(repo, ["commit", "-q", "--allow-empty", "-m", "first"]);
            await run("git", ["init", "-q", "-b", "main", outer]);
            await git(outer, ["commit", "-q", "--allow-empty", "-m", "outer"]);
            await run("git", ["clone", "-q", "--bare", repo, bare]);
            await git(bare, ["worktree", "add", "-q", "-b", "choice", linked]);

            // The bare repository is git's first record, and it has no checkout to start a session in.
            assert.deepEqual(
                (await worktreesOf(linked)).map((choice) => [choice.name, choice.main]),
                [["choice", false]],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });

    void it("leaves out a worktree whose folder is gone", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-pruned-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");

            await run("git", ["init", "-q", "-b", "main", repo]);
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
                    "-q",
                    "--allow-empty",
                    "-m",
                    "first",
                ],
                { cwd: repo },
            );

            const made = await makeWorktree(data, repo, "gone");

            await rm(made.worktree, { recursive: true, force: true });

            assert.deepEqual(
                (await worktreesOf(repo)).map((choice) => choice.name),
                ["main"],
            );
            assert.deepEqual(await worktreesOf(at), [], "and nothing for a folder outside git");
        } finally {
            await rm(at, { recursive: true, force: true });
        }
    });
});

void describe("git-worktree worktreesAmong", () => {
    void it("names the linked worktrees, and not the main checkout or a plain folder", async () => {
        const at = await mkdtemp(join(tmpdir(), "git-worktree-among-"));

        try {
            const repo = join(at, "repo");
            const data = join(at, "data");
            const theirs = join(at, "theirs");
            const plain = join(at, "plain");

            await run("git", ["init", "-q", "-b", "main", repo]);
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
                    "-q",
                    "--allow-empty",
                    "-m",
                    "first",
                ],
                { cwd: repo },
            );
            await mkdir(plain);

            const ours = await makeWorktree(data, repo, "ours");

            await mkdir(theirs);
            await run("git", ["worktree", "add", "-q", "-b", "theirs", theirs], { cwd: repo });

            assert.deepEqual(
                await worktreesAmong([repo, plain, ours.worktree, theirs, join(at, "gone")]),
                [ours.worktree, theirs],
            );
        } finally {
            await rm(at, { recursive: true, force: true });
        }
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
