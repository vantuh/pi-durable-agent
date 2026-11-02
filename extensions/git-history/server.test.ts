import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import type { Host } from "../../server/sdk.ts";
import { actions } from "./server.ts";

const run = promisify(execFile);

const host: Host = {
    name: "git-history",
    cwd: ".",
    dataDir: ".",
    log: () => undefined,
    onCommit: () => undefined,
    onDispose: () => undefined,
    shapeModelRequests: () => undefined,
    wrapModelFetch: () => undefined,
    registerModelProvider: () => () => undefined,
    resolveModelAuth: () => Promise.resolve(undefined),
    contextWindow: () => undefined,
    sessionRequest: () => Promise.resolve(undefined),
    sessionTitle: () => Promise.resolve(null),
    sessionName: () => Promise.resolve(null),
    setSessionTitle: () => Promise.resolve(),
    readDoc: (doc) => Promise.resolve(doc.definition.initial()),
    setSessionMark: () => undefined,
    folderGroup: () => undefined,
    notifySessionChanged: () => undefined,
    notify: () => undefined,
};

void describe("git-history reword", () => {
    let dir: string;
    let repo: string;
    const git = async (cwd: string, ...args: string[]) =>
        (await run("git", args, { cwd })).stdout.trim();
    const reword = (args: unknown, cwd = repo) => {
        const action = actions(host)["reword"];
        assert.ok(action);
        return action({ args, session: { id: 1, cwd } });
    };
    /** A refusal from the Git work itself, which the action hands back as a rejected promise. */
    const refuses = (args: unknown, expected: RegExp) => {
        const answer = reword(args);
        assert.ok(answer instanceof Promise);
        return assert.rejects(answer, expected);
    };
    const commit = async (message: string, name = "Test", when?: string) => {
        await git(repo, "add", "-A");
        await run("git", ["commit", "--allow-empty", "-m", message], {
            cwd: repo,
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: name,
                GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com`,
                GIT_COMMITTER_NAME: name,
                GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@example.com`,
                ...(when === undefined ? {} : { GIT_AUTHOR_DATE: when }),
            },
        });
        return (await git(repo, "rev-parse", "HEAD")).trim();
    };
    const message = async (hash: string) => git(repo, "show", "-s", "--format=%B", hash);
    const tree = async (hash: string) => git(repo, "rev-parse", `${hash}^{tree}`);
    const author = async (hash: string) =>
        git(repo, "show", "-s", "--format=%an <%ae> %ad", "--date=iso-strict", hash);

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-history-reword-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git(repo, "init", "-b", "main");
        await git(repo, "config", "user.name", "Test");
        await git(repo, "config", "user.email", "test@example.com");
        await git(repo, "config", "commit.gpgsign", "false");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("rewrites an unpushed commit and its descendants, keeping trees, authors and files", async () => {
        await writeFile(join(repo, "file"), "one\n");
        const first = await commit("first", "Anne");
        await writeFile(join(repo, "file"), "one\ntwo\n");
        const target = await commit("second", "Bob", "2001-02-03T04:05:06+0000");
        await writeFile(join(repo, "file"), "one\ntwo\nthree\n");
        const head = await commit("third", "Cleo");
        await writeFile(join(repo, "file"), "one\ntwo\nthree\ndirty\n");

        const before = { target: await tree(target), head: await tree(head) };
        const authors = { target: await author(target), head: await author(head) };

        const answer = await reword({
            hash: target,
            subject: "second, reworded",
            body: "because\n",
        });
        assert.ok(typeof answer === "object" && answer !== null);
        const rewritten = Reflect.get(answer, "hash");
        assert.equal(typeof rewritten, "string");
        assert.notEqual(rewritten, target);

        const now = (await git(repo, "rev-parse", "HEAD")).trim();
        assert.notEqual(now, head);
        assert.equal((await git(repo, "rev-parse", "HEAD~1")).trim(), rewritten);
        assert.equal((await git(repo, "rev-parse", "HEAD~2")).trim(), first);
        assert.equal(await tree(rewritten), before.target);
        assert.equal(await tree(now), before.head);
        assert.equal(await author(rewritten), authors.target);
        assert.equal(await author(now), authors.head);
        assert.equal(await message(rewritten), "second, reworded\n\nbecause");
        assert.equal(await message(now), "third");
        assert.equal(await message(first), "first");
        assert.equal(await git(repo, "status", "--porcelain"), "M file");
        assert.equal(await git(repo, "diff", "--name-only"), "file");
    });

    void it("keeps both parents of a later merge commit", async () => {
        await writeFile(join(repo, "file"), "one\n");
        const target = await commit("first");
        await git(repo, "checkout", "-b", "side");
        await writeFile(join(repo, "side"), "side\n");
        await git(repo, "add", ".");
        await commit("side");
        await git(repo, "checkout", "main");
        await git(repo, "merge", "--no-ff", "side", "-m", "merge");
        const merge = (await git(repo, "rev-parse", "HEAD")).trim();
        const parents = await git(repo, "show", "-s", "--format=%P", merge);

        await reword({ hash: target, subject: "first, reworded", body: "" });

        const now = (await git(repo, "rev-parse", "HEAD")).trim();
        assert.notEqual(now, merge);
        assert.equal((await git(repo, "show", "-s", "--format=%P", now)).split(" ").length, 2);
        assert.equal(await message(now), "merge");
        assert.notEqual(
            (await git(repo, "show", "-s", "--format=%P", now)).split(" ")[1],
            parents.split(" ")[1],
        );
    });

    void it("refuses a commit the upstream already has", async () => {
        const remote = join(dir, "remote.git");
        await git(dir, "init", "--bare", remote);
        await writeFile(join(repo, "file"), "one\n");
        await commit("pushed");
        await git(repo, "remote", "add", "origin", remote);
        await git(repo, "push", "-u", "origin", "main");
        const pushed = (await git(repo, "rev-parse", "HEAD")).trim();
        await writeFile(join(repo, "file"), "one\ntwo\n");
        const local = await commit("local");

        await refuses({ hash: pushed, subject: "again", body: "" }, /pushed already/);
        assert.equal((await git(repo, "rev-parse", "HEAD")).trim(), local);

        const answer = await reword({ hash: local, subject: "local, reworded", body: "" });
        assert.ok(typeof answer === "object" && answer !== null);
        assert.notEqual(Reflect.get(answer, "hash"), local);
        assert.equal(
            await message((await git(repo, "rev-parse", "HEAD")).trim()),
            "local, reworded",
        );
    });

    void it("rejects a blank or multi-line title and an unknown commit", async () => {
        await writeFile(join(repo, "file"), "one\n");
        const head = await commit("first");
        assert.throws(() => reword({ hash: head, subject: "  ", body: "" }), /title of one line/);
        assert.throws(
            () => reword({ hash: head, subject: "two\nlines", body: "" }),
            /title of one/,
        );
        assert.throws(
            () => reword({ hash: "not a hash", subject: "x", body: "" }),
            /Choose a commit/,
        );
        await refuses({ hash: "deadbeef", subject: "x", body: "" }, /Needed a single revision/);
        assert.equal((await git(repo, "rev-parse", "HEAD")).trim(), head);
    });
});

void describe("git-history changes", () => {
    let dir: string;
    let repo: string;
    const git = async (...args: string[]) => (await run("git", args, { cwd: repo })).stdout.trim();
    const changesOf = (args: unknown) => {
        const action = actions(host)["changes"];
        assert.ok(action);
        return action({ args, session: { id: 1, cwd: repo } });
    };
    const patchOf = async (target: string) => {
        const found = await changesOf({ target });
        assert.ok(typeof found === "object" && found !== null);
        const patch = Reflect.get(found, "patch");
        assert.equal(typeof patch, "string");
        return patch;
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-history-changes-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git("init", "-b", "main");
        await git("config", "user.name", "Test");
        await git("config", "user.email", "test@example.com");
        await git("config", "commit.gpgsign", "false");
        await writeFile(join(repo, "file"), "one\n");
        await git("add", "-A");
        await git("commit", "-m", "first");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("reads the working tree again after it changes", async () => {
        await writeFile(join(repo, "file"), "one\ndirty\n");
        assert.match(await patchOf("worktree"), /\n\+dirty/);
        await writeFile(join(repo, "file"), "one\nfresh\n");
        const later = await patchOf("worktree");
        assert.match(later, /\n\+fresh/);
        assert.doesNotMatch(later, /\+dirty/);
    });

    void it("keeps each commit's own patch", async () => {
        const first = await git("rev-parse", "HEAD");
        await writeFile(join(repo, "file"), "one\ntwo\n");
        await git("add", "-A");
        await git("commit", "-m", "second");
        const second = await git("rev-parse", "HEAD");
        assert.match(await patchOf(first), /\n\+one/);
        assert.doesNotMatch(await patchOf(first), /\n\+two/);
        assert.match(await patchOf(second), /\n\+two/);
    });
});

void describe("git-history commit", () => {
    let dir: string;
    let repo: string;
    const git = async (...args: string[]) => (await run("git", args, { cwd: repo })).stdout.trim();
    const commitOf = (args: unknown) => {
        const action = actions(host)["commit"];
        assert.ok(action);
        return action({ args, session: { id: 1, cwd: repo } });
    };
    const subjectOf = async (target: string) => {
        const found = await commitOf({ target });
        assert.ok(typeof found === "object" && found !== null);
        return found;
    };
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "git-history-commit-"));
        repo = join(dir, "repo");
        await mkdir(repo);
        await git("init", "-b", "main");
        await git("config", "user.name", "Test");
        await git("config", "user.email", "test@example.com");
        await git("config", "commit.gpgsign", "false");
        await writeFile(join(repo, "file"), "one\n");
        await git("add", "-A");
        await git("commit", "-m", "first\n\nwith a body");
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("reads one commit's message on its own", async () => {
        const hash = await git("rev-parse", "HEAD");
        const found = await subjectOf(hash);
        assert.equal(Reflect.get(found, "hash"), hash);
        assert.equal(Reflect.get(found, "subject"), "first");
        assert.equal(Reflect.get(found, "body"), "with a body");
        assert.equal(Reflect.get(found, "author"), "Test");
        assert.equal(Reflect.get(found, "short"), hash.slice(0, 7));
        assert.equal(Reflect.get(found, "remote"), false);
    });

    void it("answers an abbreviated sha with the full one", async () => {
        const hash = await git("rev-parse", "HEAD");
        assert.equal(Reflect.get(await subjectOf(hash.slice(0, 7)), "hash"), hash);
    });

    void it("refuses a sha this history does not have", async () => {
        const refuses = async (target: string) => {
            const answer = commitOf({ target });
            assert.ok(answer instanceof Promise);
            await assert.rejects(answer, /no such commit/);
        };
        await refuses("0".repeat(40));
        await refuses("not a hash");
    });
});
