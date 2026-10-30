import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { GitStats } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git statistics",
    description: "Header badge with changed lines, ahead/behind counts and a safe push button.",
};

export default function gitStats(host: Host) {
    return defineExtension({ name: host.name });
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await run("git", args, {
        cwd,
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
}

/** -z keeps tabs and newlines in paths out of the numeric fields; binary files have '-' counts. */
function totals(output: string): { added: number; deleted: number } {
    let added = 0;
    let deleted = 0;
    const fields = output.split("\0");
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index] ?? "";
        const match = /^(\d+|-)\t(\d+|-)\t/.exec(field);
        if (match === null) {
            continue;
        }
        added += Number(match[1] === "-" ? 0 : match[1]);
        deleted += Number(match[2] === "-" ? 0 : match[2]);
        // A rename's -z record has an empty path followed by the old and new paths.
        if (field.endsWith("\t")) {
            index += 2;
        }
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
    };
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

export const actions: Record<string, Action> = {
    stats({ session }) {
        return session?.cwd ? readStats(session.cwd) : null;
    },
    async push({ session }) {
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
            throw new ActionError("The branch is behind its upstream. Pull/rebase before pushing.");
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
        return readStats(session.cwd);
    },
};
