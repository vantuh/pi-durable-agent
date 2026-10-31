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

/** One of this server's worktrees: its name, and whether its folder is still there. */
export type WorktreeState = { name: string; gone: boolean };

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
            const gone: unknown = Reflect.get(value, "gone");

            if (typeof name === "string" && typeof gone === "boolean") {
                return { name, gone };
            }
        }

        throw new Error("the worktree must be its name and whether it is gone, or null");
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
