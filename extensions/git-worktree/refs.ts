import { actionRef } from "../../shared/extension-api.ts";

/** A worktree made for a new session: where it starts, its root, and the branch it is on. */
export type MadeWorktree = {
    /** The folder the session starts in: the worktree's, or the one in it that matches the session's folder. */
    path: string;
    /** The worktree's own folder. */
    worktree: string;
    branch: string;
};

export type MakeArgs = { cwd: string; name: string };

export type LinkedArgs = { folders: string[] };

/** A branch name for what someone typed: what git accepts, in lowercase. A `/` stays, so `feat/x` is a branch. */
export function slugOf(name: string): string {
    return name
        .toLowerCase()
        .split("/")
        .map((part) => part.replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, ""))
        .filter((part) => part !== "")
        .join("/")
        .slice(0, 40)
        .replace(/[-./]+$/, "");
}

/** The folder a worktree of branch `slug` lives in: one level, so a `/` becomes `-`. */
export function folderOf(slug: string): string {
    return slug.replaceAll("/", "-");
}

/**
 * One worktree of a repository: its name, the folder a session would start in, the worktree's own
 * folder, and whether it is the main checkout and the one the picked folder is in.
 */
export type WorktreeChoice = {
    name: string;
    path: string;
    root: string;
    main: boolean;
    current: boolean;
};

/**
 * A worktree a session works in: its name, its folder, whether that folder is still there, whether it
 * is the main checkout, and whether this server made it — only ours can be removed from here.
 */
export type WorktreeState = {
    name: string;
    folder: string;
    gone: boolean;
    main: boolean;
    ours: boolean;
};

/** What moving a session to a worktree did: the folder it works in now, and whether it moved at all. */
export type Entered = { moved: boolean; path: string };

/**
 * The worktree `cwd` works in: this server's, someone else's, or its repository's main checkout; null for
 * a folder outside git, and for one that is not there.
 */
export const state = actionRef<{ cwd: string }, WorktreeState | null>(
    "git-worktree",
    "state",
    (value) => {
        if (value === null) {
            return null;
        }

        if (typeof value === "object") {
            const name: unknown = Reflect.get(value, "name");
            const folder: unknown = Reflect.get(value, "folder");
            const gone: unknown = Reflect.get(value, "gone");
            const main: unknown = Reflect.get(value, "main");
            const ours: unknown = Reflect.get(value, "ours");

            if (
                typeof name === "string" &&
                typeof folder === "string" &&
                typeof gone === "boolean" &&
                typeof main === "boolean" &&
                typeof ours === "boolean"
            ) {
                return { name, folder, gone, main, ours };
            }
        }

        throw new Error(
            "the worktree must be its name, its folder, its state, whether it is the main checkout and its owner, or null",
        );
    },
);

/** Removes the worktree a session works in: the folder, but not the branch. */
export const remove = actionRef<{ cwd: string }, { removed: string }>(
    "git-worktree",
    "remove",
    (value) => {
        const removed: unknown =
            typeof value === "object" && value !== null ? Reflect.get(value, "removed") : undefined;

        if (typeof removed !== "string") {
            throw new Error("the removal must answer with the folder it removed");
        }

        return { removed };
    },
);

function enteredFrom(value: unknown): Entered {
    if (typeof value === "object" && value !== null) {
        const moved: unknown = Reflect.get(value, "moved");
        const path: unknown = Reflect.get(value, "path");

        if (typeof moved === "boolean" && typeof path === "string") {
            return { moved, path };
        }
    }

    throw new Error("the move must be whether the session moved and the folder it works in");
}

/**
 * Moves the session to one of its repository's worktrees, named by the worktree's own folder. The list
 * is read again on the server, so a folder of another repository is refused.
 */
export const move = actionRef<{ worktree: string }, Entered>("git-worktree", "move", enteredFrom);

/** Makes a worktree named after what the person typed and moves the session into it at once. */
export const create = actionRef<{ name: string }, Entered>("git-worktree", "create", enteredFrom);

/** Makes a worktree of `cwd`'s repository, named after what the person typed in the folder picker. */
export const make = actionRef<MakeArgs, MadeWorktree>("git-worktree", "make", (value) => {
    if (typeof value === "object" && value !== null) {
        const path: unknown = Reflect.get(value, "path");
        const worktree: unknown = Reflect.get(value, "worktree");
        const branch: unknown = Reflect.get(value, "branch");

        if (
            typeof path === "string" &&
            typeof worktree === "string" &&
            typeof branch === "string"
        ) {
            return { path, worktree, branch };
        }
    }

    throw new Error("the worktree must be its folder, its root and its branch");
});

/** The worktrees of the repository `cwd` is in: the main checkout first, then the linked ones. */
export const worktrees = actionRef<{ cwd: string }, WorktreeChoice[]>(
    "git-worktree",
    "worktrees",
    (value) => {
        if (!Array.isArray(value)) {
            throw new Error("the worktrees must be a list");
        }

        return value.map((entry: unknown): WorktreeChoice => {
            const row = typeof entry === "object" && entry !== null ? entry : undefined;
            const name: unknown = row === undefined ? undefined : Reflect.get(row, "name");
            const path: unknown = row === undefined ? undefined : Reflect.get(row, "path");
            const root: unknown = row === undefined ? undefined : Reflect.get(row, "root");
            const main: unknown = row === undefined ? undefined : Reflect.get(row, "main");
            const current: unknown = row === undefined ? undefined : Reflect.get(row, "current");

            if (
                typeof name === "string" &&
                typeof path === "string" &&
                typeof root === "string" &&
                typeof main === "boolean" &&
                typeof current === "boolean"
            ) {
                return { name, path, root, main, current };
            }

            throw new Error(
                "a worktree must be its name, its folder, its root, whether it is the main checkout and whether it is the one picked",
            );
        });
    },
);

/** The folders among these that are linked worktrees, which the picker leaves out of its lists. */
export const linked = actionRef<LinkedArgs, string[]>("git-worktree", "linked", (value) => {
    if (Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string")) {
        return value;
    }

    throw new Error("the linked worktrees must be folders");
});
