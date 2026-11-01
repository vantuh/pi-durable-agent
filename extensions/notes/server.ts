/**
 * Notes: one Markdown scratchpad per repository, kept in the data directory and shown in the Notes
 * panel. The agent never sees it: no tools, no prompt sections, no hooks.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, writeFileAtomic, type Action, type Host } from "../../server/sdk.ts";
import type { Note, WriteResult } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Notes",
    description: "A personal Markdown scratchpad per repository. The agent does not read it.",
};

export default function notes(host: Host) {
    return defineExtension({ name: host.name });
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * The repository a folder belongs to: the main worktree for any worktree or subfolder of a git
 * repository, else the folder itself.
 */
export async function repositoryOf(cwd: string): Promise<string> {
    const folder = await realpath(cwd).catch(() => resolve(cwd));

    try {
        const { stdout } = await run("git", ["rev-parse", "--git-common-dir"], {
            cwd: folder,
            timeout: 5000,
        });
        const common = await realpath(resolve(folder, stdout.trim()));

        return basename(common) === ".git" ? dirname(common) : common;
    } catch {
        return folder;
    }
}

export function noteFile(dataDir: string, root: string): string {
    const slug =
        basename(root)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40) || "note";

    return join(
        dataDir,
        "notes",
        `${slug}-${createHash("sha256").update(root).digest("hex").slice(0, 10)}.md`,
    );
}

async function load(file: string): Promise<Note> {
    const text = await readFile(file, "utf8").catch((error: unknown) => {
        if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
            return "";
        }

        throw error;
    });

    return { text, version: hash(text) };
}

/**
 * Check-then-write must not interleave with another write. A reload builds a new `actions()` while the
 * old one may still be writing, so the tail of the queue lives on `globalThis`, not in the closure.
 */
const QUEUE = Symbol.for("pi-durable-agent.notes.queue");

function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const tail: unknown = Reflect.get(globalThis, QUEUE);
    const next = (tail instanceof Promise ? tail : Promise.resolve()).then(work);

    Reflect.set(
        globalThis,
        QUEUE,
        next.catch(() => undefined),
    );

    return next;
}

export const actions = (host: Pick<Host, "dataDir">): Record<string, Action> => {
    const fileOf = async ({ session }: Parameters<Action>[0]): Promise<string | null> => {
        const cwd = session?.cwd;

        return cwd === undefined || cwd === null
            ? null
            : noteFile(host.dataDir, await repositoryOf(cwd));
    };

    return {
        async read(call): Promise<Note | null> {
            const file = await fileOf(call);

            return file === null ? null : load(file);
        },

        async write(call): Promise<WriteResult> {
            const text: unknown =
                typeof call.args === "object" && call.args !== null
                    ? Reflect.get(call.args, "text")
                    : undefined;
            const base: unknown =
                typeof call.args === "object" && call.args !== null
                    ? Reflect.get(call.args, "base")
                    : undefined;

            if (typeof text !== "string" || typeof base !== "string") {
                throw new ActionError("args must be { text: string, base: string }");
            }

            return await enqueue(async (): Promise<WriteResult> => {
                const file = await fileOf(call);

                if (file === null) {
                    throw new ActionError("This session has no folder, so it has no note.");
                }

                const current = await load(file);

                if (current.version !== base) {
                    return { conflict: true, ...current };
                }

                await writeFileAtomic(file, text);

                return { conflict: false, version: hash(text) };
            });
        },
    };
};
