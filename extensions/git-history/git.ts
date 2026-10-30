/** Local Git reads, and the one write of giving a local commit a new message. No fetch, checkout or push. */
import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { ActionError } from "../../server/sdk.ts";
import {
    UNTRACKED_FILE_CAP,
    type ChangedFile,
    type Changes,
    type Commit,
    type History,
} from "./refs.ts";

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
function gitMessage(error: unknown): string {
    if (typeof error === "object" && error !== null && "stderr" in error) {
        const stderr: unknown = error.stderr;
        if (typeof stderr === "string" && stderr.trim() !== "") {
            return stderr.trim();
        }
    }
    return error instanceof Error ? error.message : String(error);
}

/** A Git command whose failure is the person's answer, with Git's own words. */
async function must(cwd: string, args: string[]): Promise<string> {
    try {
        return await git(cwd, args);
    } catch (error) {
        throw new ActionError(gitMessage(error));
    }
}

/** `git commit-tree` with the message on its stdin: it prints the new commit's id. */
function commitTree(
    cwd: string,
    args: string[],
    message: string,
    env: NodeJS.ProcessEnv,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            "git",
            ["commit-tree", ...args, "-F", "-"],
            {
                cwd,
                timeout: 15000,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
            },
            (failure, stdout, stderr) => {
                if (failure === null) {
                    resolve(stdout.trim());
                } else {
                    reject(new ActionError(stderr.trim() || failure.message));
                }
            },
        );
        child.stdin?.end(message);
    });
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

const LOG = "%H%x00%h%x00%an%x00%at%x00%s%x00%b";
function commitsOf(output: string, local: Set<string>, remote: boolean): Commit[] {
    const fields = output.split("\0");
    const commits: Commit[] = [];
    for (let index = 0; index + 5 < fields.length; index += 6) {
        const hash = fields[index] ?? "";
        commits.push({
            hash,
            short: fields[index + 1] ?? "",
            author: fields[index + 2] ?? "",
            at: Number(fields[index + 3]) * 1000,
            subject: fields[index + 4] ?? "",
            body: (fields[index + 5] ?? "").trim(),
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
    // A pruned upstream keeps its name in the status but loses branch.ab, and @{upstream} then
    // cannot be resolved.
    const local =
        upstream === null || counts === null
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

/**
 * Preview is bounded; review patches are never silently truncated. `stat` is injected so a test can
 * hold the listing and the reading apart, as a file vanishing between them does in real life.
 */
export async function readChanges(
    cwd: string,
    target: string,
    cap = PATCH_CAP,
    stat: (path: string) => Promise<Stats> = lstat,
): Promise<Changes> {
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
        if (untracked.length > UNTRACKED_FILE_CAP) {
            truncated = true;
        }
        for (const path of untracked.slice(0, UNTRACKED_FILE_CAP)) {
            const info = await stat(join(root, path)).catch((error: unknown) => {
                // Something removed a file Git had listed, before it was read: it is not there.
                if (
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    error.code === "ENOENT"
                ) {
                    return null;
                }
                throw error;
            });
            if (info === null || info.isDirectory()) {
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

/**
 * Gives a commit a new message, and writes again every commit after it on the checked-out branch
 * with the same trees, authors and messages. Neither the index nor the working files are touched:
 * no tree changes, so the files stay exactly as they are. A commit the upstream can reach is
 * refused, since a plain push could not send the new history.
 */
export async function reword(
    cwd: string,
    hash: string,
    subject: string,
    body: string,
): Promise<{ hash: string }> {
    const root = await rootOf(cwd);
    const target = (
        await must(root, ["rev-parse", "--verify", "--end-of-options", `${hash}^{commit}`])
    ).trim();
    const head = (await must(root, ["rev-parse", "--verify", "HEAD"])).trim();
    const reaches = (ref: string) =>
        git(root, ["merge-base", "--is-ancestor", target, ref]).then(
            () => true,
            () => false,
        );
    if (!(await reaches("HEAD"))) {
        throw new ActionError("Only a commit of the checked-out branch can be edited.");
    }
    const upstream = (
        await git(root, ["rev-parse", "--verify", "--quiet", "@{upstream}"]).catch(() => "")
    ).trim();
    if (upstream !== "" && (await reaches(upstream))) {
        throw new ActionError("This commit is pushed already: its message cannot change here.");
    }
    const sign = await git(root, ["config", "--bool", "commit.gpgsign"]).then(
        (value) => value.trim() === "true",
        () => false,
    );
    const later = (
        await must(root, [
            "rev-list",
            "--reverse",
            "--topo-order",
            "--ancestry-path",
            "--parents",
            `${target}..${head}`,
        ])
    )
        .split("\n")
        .filter((line) => line !== "");
    const parentsOf = async (commit: string) =>
        (await must(root, ["show", "-s", "--format=%P", commit]))
            .trim()
            .split(" ")
            .filter((parent) => parent !== "");
    const renamed = new Map<string, string>();
    const rewritten = (commit: string) => {
        const found = renamed.get(commit);
        if (found === undefined) {
            throw new ActionError("The branch moved while the message was being rewritten.");
        }
        return found;
    };
    const steps: { commit: string; parents: string[]; message: string | null }[] = [
        {
            commit: target,
            parents: await parentsOf(target),
            message: `${subject}\n${body === "" ? "" : `\n${body}\n`}`,
        },
        ...later.map((line) => {
            const [commit = "", ...parents] = line.split(" ");
            return { commit, parents, message: null };
        }),
    ];
    for (const step of steps) {
        const [tree = "", name = "", email = "", date = "", message = ""] = (
            await must(root, [
                "show",
                "-s",
                "--date=raw",
                "--format=%T%x00%an%x00%ae%x00%ad%x00%B",
                step.commit,
            ])
        ).split("\0");
        renamed.set(
            step.commit,
            await commitTree(
                root,
                [
                    tree,
                    ...step.parents.flatMap((parent) => ["-p", renamed.get(parent) ?? parent]),
                    ...(sign ? ["-S"] : []),
                ],
                step.message ?? `${message.trimEnd()}\n`,
                { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date },
            ),
        );
    }
    // The old id travels with the move: it fails if the branch moved meanwhile. The reflog keeps the
    // old history, so nothing is lost.
    await must(root, [
        "update-ref",
        "-m",
        `git-history: reword ${target.slice(0, 7)}`,
        "HEAD",
        rewritten(head),
        head,
    ]);
    return { hash: rewritten(target) };
}
