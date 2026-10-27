import { actionRef } from "../../shared/extension-api.ts";

/** Where a session's folder is checked out: its branch, and the worktree's name when it is a linked one. */
export type Checkout = { branch: string; worktree: string | null };

/** The checkout of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, Checkout | null>("git-branch", "branch", (value) => {
    if (value === null) {
        return null;
    }

    if (typeof value === "object") {
        const name: unknown = Reflect.get(value, "branch");
        const worktree: unknown = Reflect.get(value, "worktree");

        if (typeof name === "string" && (typeof worktree === "string" || worktree === null)) {
            return { branch: name, worktree };
        }
    }

    throw new Error("the checkout must be a branch and a worktree name, or null");
});
