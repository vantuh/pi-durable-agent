/**
 * Notes: one plain-text scratchpad and one to-do list per repository, kept in the data directory and
 * shown in the Notes panel. The agent never sees them: no tools, no prompt sections, no hooks.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import {
    ActionError,
    writeFileAtomic,
    writeJsonFile,
    type Action,
    type Host,
} from "../../server/sdk.ts";
import { asTodos, type Note, type Todo, type WriteResult } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Notes",
    description:
        "A personal scratchpad and to-do list per repository. The agent does not read them.",
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

const readText = (file: string): Promise<string | null> =>
    readFile(file, "utf8").catch((error: unknown) => {
        if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
            return null;
        }

        throw error;
    });

async function load(file: string): Promise<Note> {
    const text = (await readText(file)) ?? "";

    return { text, version: hash(text) };
}

const CHECKBOX = /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+(\S.*?)[ \t]*$/;

/** Splits the checkbox lines (`- [ ] title`, `* [x] title`) out of a note's text. */
export function takeTasks(text: string): {
    tasks: { title: string; done: boolean }[];
    rest: string;
} {
    const tasks: { title: string; done: boolean }[] = [];
    const rest = text.split("\n").filter((line) => {
        const [, mark, title] = CHECKBOX.exec(line) ?? [];

        if (mark === undefined || title === undefined) {
            return true;
        }

        tasks.push({ title, done: mark !== " " });

        return false;
    });

    return { tasks, rest: rest.join("\n") };
}

type Stored = { next: number; items: Todo[] };

export const todosFile = (note: string): string => note.replace(/\.md$/, ".todos.json");

/**
 * The repository's to-dos. The first read, when there is no list yet, moves the note's checkboxes
 * into it: the list is written before the note, so a crash between the two loses nothing.
 */
async function loadTodos(note: string): Promise<Stored> {
    const file = todosFile(note);
    const text = await readText(file);

    if (text !== null) {
        const stored: unknown = JSON.parse(text);
        const next: unknown =
            typeof stored === "object" && stored !== null ? Reflect.get(stored, "next") : undefined;

        if (typeof next !== "number" || typeof stored !== "object" || stored === null) {
            throw new Error(`${file} is not a to-do list`);
        }

        return { next, items: asTodos(Reflect.get(stored, "items")) };
    }

    const { tasks, rest } = takeTasks((await load(note)).text);
    const stored: Stored = {
        next: tasks.length + 1,
        items: tasks.map((task, index) => ({ id: index + 1, description: "", ...task })),
    };

    await writeJsonFile(file, stored);

    if (tasks.length > 0) {
        await writeFileAtomic(note, rest);
    }

    return stored;
}

const field = (args: unknown, name: string): unknown =>
    typeof args === "object" && args !== null ? Reflect.get(args, name) : undefined;

const titleOf = (value: unknown): string => {
    const title = typeof value === "string" ? value.trim() : "";

    if (title === "") {
        throw new ActionError("title must be a nonempty string");
    }

    return title;
};

const indexOf = (items: Todo[], id: unknown): number => {
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
        throw new ActionError(`No to-do ${String(id)}`);
    }

    return index;
};

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

    /** Edits the to-dos in the queue, so two changes never write over each other. */
    const change =
        (edit: (stored: Stored, args: unknown) => void): Action =>
        (call) =>
            enqueue(async (): Promise<Todo[]> => {
                const file = await fileOf(call);

                if (file === null) {
                    throw new ActionError("This session has no folder, so it has no to-dos.");
                }

                const stored = await loadTodos(file);

                edit(stored, call.args);
                await writeJsonFile(todosFile(file), stored);

                return stored.items;
            });

    return {
        async read(call): Promise<Note | null> {
            const file = await fileOf(call);

            // The note is read after the to-dos, whose first read may take its checkboxes.
            return file === null
                ? null
                : enqueue(async () => {
                      await loadTodos(file);

                      return load(file);
                  });
        },

        async todos(call): Promise<Todo[] | null> {
            const file = await fileOf(call);

            return file === null ? null : enqueue(async () => (await loadTodos(file)).items);
        },

        addTodo: change((stored, args) => {
            stored.items.push({
                id: stored.next++,
                title: titleOf(field(args, "title")),
                description: "",
                done: false,
            });
        }),

        updateTodo: change((stored, args) => {
            const todo = stored.items[indexOf(stored.items, field(args, "id"))];
            const title = field(args, "title");
            const description = field(args, "description");
            const done = field(args, "done");

            if (todo === undefined) {
                return;
            }

            if (title !== undefined) {
                todo.title = titleOf(title);
            }

            if (typeof description === "string") {
                todo.description = description;
            }

            if (typeof done === "boolean") {
                todo.done = done;
            }
        }),

        moveTodo: change((stored, args) => {
            const from = indexOf(stored.items, field(args, "id"));
            const to = indexOf(stored.items, field(args, "over"));

            stored.items.splice(to, 0, ...stored.items.splice(from, 1));
        }),

        removeTodo: change((stored, args) => {
            stored.items.splice(indexOf(stored.items, field(args, "id")), 1);
        }),

        restoreTodo: change((stored, args) => {
            const [todo] = asTodos([field(args, "todo")]);
            const index = field(args, "index");

            if (todo === undefined || typeof index !== "number") {
                throw new ActionError("args must be { todo, index: number }");
            }

            // A second undo of the same removal finds it back already.
            if (stored.items.every((item) => item.id !== todo.id)) {
                stored.items.splice(index, 0, todo);
                stored.next = Math.max(stored.next, todo.id + 1);
            }
        }),

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

                await loadTodos(file);

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
