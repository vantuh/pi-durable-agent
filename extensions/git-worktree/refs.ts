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

/**
 * One worktree of a repository: its name, the folder a session would start in, and whether it is the
 * main checkout and the one the picked folder is in.
 */
export type WorktreeChoice = { name: string; path: string; main: boolean; current: boolean };

/**
 * A worktree a session works in: its name, its folder, whether that folder is still there, and whether
 * this server made it — only ours can be removed from here.
 */
export type WorktreeState = { name: string; folder: string; gone: boolean; ours: boolean };

/** Whether `cwd` is a worktree this server made, and whether it is still there; null for any other folder. */
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
            const ours: unknown = Reflect.get(value, "ours");

            if (
                typeof name === "string" &&
                typeof folder === "string" &&
                typeof gone === "boolean" &&
                typeof ours === "boolean"
            ) {
                return { name, folder, gone, ours };
            }
        }

        throw new Error(
            "the worktree must be its name, its folder, its state and its owner, or null",
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
            const main: unknown = row === undefined ? undefined : Reflect.get(row, "main");
            const current: unknown = row === undefined ? undefined : Reflect.get(row, "current");

            if (
                typeof name === "string" &&
                typeof path === "string" &&
                typeof main === "boolean" &&
                typeof current === "boolean"
            ) {
                return { name, path, main, current };
            }

            throw new Error(
                "a worktree must be its name, its folder, whether it is the main checkout and whether it is the one picked",
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
