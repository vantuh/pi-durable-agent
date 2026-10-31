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

/** What a worktree of `cwd` would start from: its branch, or the commit a detached head stands on. */
export const head = actionRef<{ cwd: string }, string | null>("git-worktree", "head", (value) => {
    if (value === null || typeof value === "string") {
        return value;
    }

    throw new Error("the head must be a branch name or a commit, or null");
});

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
