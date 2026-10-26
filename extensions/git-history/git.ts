/** Local Git reads only. No fetch, checkout, reword or push. */
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { ActionError } from "../../server/extensions.ts";
import type { ChangedFile, Changes, Commit, History } from "./refs.ts";

const run = promisify(execFile);
export const PATCH_CAP = 400 * 1024;
const FLAGS = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];

export async function git(
    cwd: string,
    args: string[],
    maxBuffer = 8 * 1024 * 1024,
): Promise<string> {
    try {
        return (
            await run("git", ["--no-pager", ...args], {
                cwd,
                timeout: 15000,
                maxBuffer,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
            })
        ).stdout;
    } catch (error) {
        if (
            args.includes("--no-index") &&
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === 1 &&
            "stdout" in error &&
            typeof error.stdout === "string"
        ) {
            return error.stdout;
        }
        throw error;
    }
}
export async function rootOf(cwd: string): Promise<string> {
    try {
        return (await git(cwd, ["rev-parse", "--show-toplevel"])).trimEnd();
    } catch {
        throw new ActionError("This session's folder is not a Git working tree.");
    }
}

export async function resolveCommit(cwd: string, target: string): Promise<string> {
    if (!/^[0-9a-f]{4,64}$/i.test(target)) {
        throw new ActionError("Choose a commit from the history.");
    }
    return (
        await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${target}^{commit}`])
    ).trim();
}

const LOG = "%H%x00%h%x00%an%x00%at%x00%s";
function commitsOf(output: string, local: Set<string>, remote: boolean): Commit[] {
    const fields = output.split("\0");
    const commits: Commit[] = [];
    for (let index = 0; index + 4 < fields.length; index += 5) {
        const hash = fields[index] ?? "";
        commits.push({
            hash,
            short: fields[index + 1] ?? "",
            author: fields[index + 2] ?? "",
            at: Number(fields[index + 3]) * 1000,
            subject: fields[index + 4] ?? "",
            unpushed: local.has(hash),
            remote,
        });
    }
    return commits;
}
export async function readHistory(cwd: string, limit: number): Promise<History> {
    const root = await rootOf(cwd);
    const state = await git(root, [
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=all",
    ]);
    const upstream = /^# branch\.upstream (.+)$/m.exec(state)?.[1] ?? null;
    const counts = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(state);
    const branch = /^# branch\.head (.+)$/m.exec(state)?.[1] ?? "HEAD";
    const changed = state.split("\n").filter((line) => line !== "" && !line.startsWith("#")).length;
    if (state.includes("# branch.oid (initial)")) {
        return {
            branch,
            upstream,
            ahead: 0,
            behind: 0,
            changes: changed,
            commits: [],
            more: false,
        };
    }
    const local =
        upstream === null
            ? new Set<string>()
            : new Set(
                  (await git(root, ["rev-list", "HEAD", "--not", "@{upstream}"]))
                      .trim()
                      .split("\n"),
              );
    const own = commitsOf(
        await git(root, ["log", "-z", `-n${limit + 1}`, `--format=${LOG}`, "HEAD", "--"]),
        local,
        false,
    );
    const incoming =
        upstream === null || Number(counts?.[2] ?? 0) === 0
            ? []
            : commitsOf(
                  await git(root, [
                      "log",
                      "-z",
                      `-n${limit}`,
                      `--format=${LOG}`,
                      "@{upstream}",
                      "--not",
                      "HEAD",
                      "--",
                  ]),
                  new Set(),
                  true,
              );
    return {
        branch,
        upstream,
        ahead: Number(counts?.[1] ?? 0),
        behind: Number(counts?.[2] ?? 0),
        changes: changed,
        commits: [...incoming, ...own.slice(0, limit)],
        more: own.length > limit,
    };
}

export function filesOf(output: string): ChangedFile[] {
    const fields = output.split("\0");
    const files: ChangedFile[] = [];
    for (let index = 0; index < fields.length; index += 1) {
        const row = fields[index] ?? "";
        const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(row);
        if (match === null) {
            continue;
        }
        let path = match[3] ?? "";
        if (path === "") {
            path = fields[index + 2] ?? "";
            index += 2;
        }
        files.push({
            path,
            added: match[1] === "-" ? 0 : Number(match[1]),
            deleted: match[2] === "-" ? 0 : Number(match[2]),
            binary: match[1] === "-",
        });
    }
    return files;
}

/** Preview is bounded; review patches are never silently truncated. */
export async function readChanges(cwd: string, target: string, cap = PATCH_CAP): Promise<Changes> {
    const root = await rootOf(cwd);
    const work = target === "worktree";
    let title = "Uncommitted changes";
    let range: string[];
    if (work) {
        const head = await git(root, ["rev-parse", "--verify", "HEAD"]).then(
            (s) => s.trim(),
            () => undefined,
        );
        range = [head ?? (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).trim()];
    } else {
        const full = await resolveCommit(root, target);
        const parent = await git(root, ["rev-parse", "--verify", `${full}^1`]).then(
            (s) => s.trim(),
            () => undefined,
        );
        range = [
            parent ?? (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).trim(),
            full,
        ];
        title = (await git(root, ["log", "-1", "--format=%s", full])).trimEnd();
    }
    const args = ["diff", ...FLAGS, "-M"];
    const files = filesOf(await git(root, [...args, "--numstat", "-z", ...range, "--"]));
    let truncated = false;
    let patch = await git(root, [...args, ...range, "--"], cap).catch((error: unknown) => {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ) {
            truncated = true;
            return "";
        }
        throw error;
    });
    if (work) {
        const untracked = (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
            .split("\0")
            .filter(Boolean);
        for (const path of untracked) {
            const info = await lstat(join(root, path));
            if (info.isDirectory()) {
                continue;
            }
            // --no-index may follow symlinks; never read their external targets.
            if (info.isSymbolicLink()) {
                files.push({ path, added: 1, deleted: 0, binary: false });
                truncated = true;
                continue;
            }
            const extra = ["diff", "--no-index", ...FLAGS];
            files.push(
                ...filesOf(await git(root, [...extra, "--numstat", "-z", "--", "/dev/null", path])),
            );
            if (info.size > cap || Buffer.byteLength(patch) + info.size > cap) {
                truncated = true;
                continue;
            }
            const next = await git(root, [...extra, "--", "/dev/null", path], cap).catch(
                (error: unknown) => {
                    if (
                        typeof error === "object" &&
                        error !== null &&
                        "code" in error &&
                        error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                    ) {
                        truncated = true;
                        return "";
                    }
                    throw error;
                },
            );
            if (Buffer.byteLength(patch + next) <= cap) {
                patch += next;
            } else {
                truncated = true;
            }
        }
    }
    return { title, files, patch, truncated };
}
