import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { ActionError, type Action } from "../../../server/sdk.ts";
import type { GitStats } from "../refs.ts";
import { filesOf, git } from "./git.ts";

// Only the push needs its own call: it is a write with a longer timeout than the reads in `git.ts` allow.
const run = promisify(execFile);

/** -z keeps tabs and newlines in paths out of the numeric fields; binary files have '-' counts. */
function totals(output: string): { added: number; deleted: number } {
    let added = 0;
    let deleted = 0;
    for (const file of filesOf(output)) {
        added += file.added;
        deleted += file.deleted;
    }
    return { added, deleted };
}

function missing(error: unknown): null {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return null;
    }
    throw error;
}

/** Git calls a file binary when a NUL sits in its first 8000 bytes, and then reports no lines. */
const isBinary = (content: Buffer): boolean => content.subarray(0, 8000).includes(0);

/** What numstat gives a new file: a line per newline, plus a last line that has none. */
function lines(content: Buffer): number {
    let count = 0;
    for (let at = content.indexOf(0x0a); at !== -1; at = content.indexOf(0x0a, at + 1)) {
        count += 1;
    }
    return content.length > 0 && content.at(-1) !== 0x0a ? count + 1 : count;
}

/**
 * The main checkout's branch when `root` is a linked worktree: its arrows then compare with that
 * local branch, not a remote. A bare, detached or unborn main checkout is `null`, and the upstream
 * arrows stand, as they do when the compare itself fails.
 */
async function worktreeBase(root: string): Promise<{ ref: string; name: string } | null> {
    try {
        // `-z`: a worktree path may hold spaces or newlines. The main worktree is the first record.
        const main = (
            (await git(root, ["worktree", "list", "--porcelain", "-z"])).split("\0\0")[0] ?? ""
        ).split("\0");
        const path = main.find((field) => field.startsWith("worktree "))?.slice("worktree ".length);
        if (path === root) {
            return null;
        }
        const ref = main.find((field) => field.startsWith("branch "))?.slice("branch ".length);
        return ref === undefined ? null : { ref, name: ref.replace(/^refs\/heads\//, "") };
    } catch {
        return null;
    }
}

async function readStats(cwd: string): Promise<GitStats | null> {
    let root: string;
    try {
        root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
        return null;
    }
    const state = await git(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
    const upstream = /^# branch\.upstream (.+)$/m.exec(state)?.[1] ?? null;
    const counts = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(state);
    const unborn = state.includes("# branch.oid (initial)");
    const diffArgs = ["--numstat", "-z", "--no-ext-diff", "--no-textconv"];
    const tracked = unborn ? "" : await git(root, ["diff", ...diffArgs, "HEAD", "--"]);
    const result: GitStats = {
        ...totals(tracked),
        upstream,
        ahead: Number(counts?.[1] ?? 0),
        behind: Number(counts?.[2] ?? 0),
        worktree: null,
    };
    const base = await worktreeBase(root);
    if (base !== null) {
        try {
            const [ahead, behind] = (
                await git(root, ["rev-list", "--left-right", "--count", `HEAD...${base.ref}`])
            )
                .trim()
                .split("\t");
            result.worktree = {
                base: base.name,
                ahead: Number(ahead ?? 0),
                behind: Number(behind ?? 0),
            };
        } catch {
            // An unborn HEAD here has no commits to count; the upstream arrows stand.
        }
    }
    const untracked = await git(root, [
        "ls-files",
        ...(unborn ? ["--cached"] : []),
        "--others",
        "--exclude-standard",
        "-z",
    ]);
    for (const path of new Set(untracked.split("\0").filter(Boolean))) {
        const info = await lstat(join(root, path)).catch(missing);
        if (info === null || info.isDirectory()) {
            continue;
        }
        // Git diffs a link as its target text: one line, and following it may leave the checkout.
        if (info.isSymbolicLink()) {
            result.added += 1;
            continue;
        }
        const content = await readFile(join(root, path)).catch(missing);
        if (content !== null && !isBinary(content)) {
            result.added += lines(content);
        }
    }
    return result;
}

const same = (a: GitStats | null, b: GitStats | null): boolean =>
    a === null || b === null
        ? a === b
        : a.added === b.added &&
          a.deleted === b.deleted &&
          a.upstream === b.upstream &&
          a.ahead === b.ahead &&
          a.behind === b.behind &&
          a.worktree?.base === b.worktree?.base &&
          a.worktree?.ahead === b.worktree?.ahead &&
          a.worktree?.behind === b.worktree?.behind;

const LEASE_MS = 3 * 60_000;
const POLL_MS = 3000;

export type StatsWatch = {
    readonly actions: { readonly stats: Action; readonly push: Action };
    /** One polling pass over the leased sessions; the timer calls it, tests call it directly. */
    readonly poll: () => Promise<void>;
    readonly dispose: () => void;
};

/**
 * The `stats` and `push` actions plus a poller. A `stats` call leases its session for three minutes
 * (the browser's slow poll renews it); while leases exist, the repositories are read every few
 * seconds and a session whose numbers changed is announced through `notify`.
 */
export function watchStats(options: {
    notify: (session: number) => void;
    log: (message: string) => void;
    now?: () => number;
    pollMs?: number;
}): StatsWatch {
    const now = options.now ?? Date.now;
    const pollMs = options.pollMs ?? POLL_MS;
    const leases = new Map<number, { cwd: string; expires: number }>();
    const cache = new Map<string, { value: GitStats | null; at: number }>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let polling = false;

    const stop = () => {
        clearInterval(timer);
        timer = undefined;
    };
    /** Stores a reading; sessions of that folder other than `except` hear of a change from the last one. */
    const record = (cwd: string, value: GitStats | null, except?: number) => {
        const previous = cache.get(cwd);
        cache.set(cwd, { value, at: now() });
        if (previous === undefined || same(previous.value, value)) {
            return;
        }
        for (const [session, lease] of leases) {
            if (lease.cwd === cwd && session !== except) {
                options.notify(session);
            }
        }
    };
    const poll = async () => {
        if (polling) {
            return;
        }
        polling = true;
        try {
            for (const [session, lease] of leases) {
                if (lease.expires <= now()) {
                    leases.delete(session);
                }
            }
            const folders = new Set([...leases.values()].map((lease) => lease.cwd));
            for (const cwd of cache.keys()) {
                if (!folders.has(cwd)) {
                    cache.delete(cwd);
                }
            }
            if (folders.size === 0) {
                stop();
            }
            for (const cwd of folders) {
                try {
                    record(cwd, await readStats(cwd));
                } catch {
                    options.log("git-history: could not read the repository statistics");
                }
            }
        } finally {
            polling = false;
        }
    };
    const lease = (session: number, cwd: string) => {
        leases.set(session, { cwd, expires: now() + LEASE_MS });
        if (timer === undefined) {
            timer = setInterval(() => void poll(), pollMs);
            timer.unref();
        }
    };

    const actions = {
        async stats({ session }: Parameters<Action>[0]) {
            if (!session?.cwd) {
                return null;
            }
            lease(session.id, session.cwd);
            const cached = cache.get(session.cwd);
            if (cached !== undefined && now() - cached.at < pollMs) {
                return cached.value;
            }
            const value = await readStats(session.cwd);
            record(session.cwd, value, session.id);
            return value;
        },
        async push({ session }: Parameters<Action>[0]) {
            if (!session?.cwd) {
                throw new ActionError("Open a session in a Git repository first.");
            }
            const current = await readStats(session.cwd);
            if (current === null || current.upstream === null) {
                throw new ActionError(
                    "No upstream configured. Set the branch's upstream in Git first.",
                );
            }
            if (current.behind > 0) {
                throw new ActionError(
                    "The branch is behind its upstream. Pull/rebase before pushing.",
                );
            }
            if (current.ahead === 0) {
                throw new ActionError("No commits to push.");
            }
            // Explicitly push only HEAD to this branch's upstream, regardless of push.default/refspecs.
            const branch = (await git(session.cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
            const remote = (
                await git(session.cwd, ["config", "--get", `branch.${branch}.remote`])
            ).trim();
            const target = (
                await git(session.cwd, ["config", "--get", `branch.${branch}.merge`])
            ).trim();
            await run(
                "git",
                [
                    "-c",
                    "push.followTags=false",
                    "-c",
                    `remote.${remote}.mirror=false`,
                    "push",
                    "--no-force",
                    "--recurse-submodules=no",
                    "--",
                    remote,
                    `HEAD:${target}`,
                ],
                {
                    cwd: session.cwd,
                    timeout: 60000,
                    maxBuffer: 1024 * 1024,
                    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
                },
            );
            const value = await readStats(session.cwd);
            record(session.cwd, value, session.id);
            return value;
        },
    };
    return {
        actions,
        poll,
        dispose: () => {
            stop();
            leases.clear();
            cache.clear();
        },
    };
}
