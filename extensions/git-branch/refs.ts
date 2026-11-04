import { actionRef } from "../../shared/extension-api.ts";

/** Where a session's folder is checked out: its branch. */
export type Checkout = { branch: string };

/** A local branch, and the folder of the worktree that has it checked out, when that is not the session's own. */
export type Branch = { name: string; worktree: string | null };

function checkoutFrom(value: unknown): Checkout {
    if (typeof value === "object" && value !== null) {
        const name: unknown = Reflect.get(value, "branch");

        if (typeof name === "string") {
            return { branch: name };
        }
    }

    throw new Error("the checkout must be a branch");
}

function branchFrom(value: unknown): Branch {
    if (typeof value === "object" && value !== null) {
        const name: unknown = Reflect.get(value, "name");
        const worktree: unknown = Reflect.get(value, "worktree");

        if (typeof name === "string" && (worktree === null || typeof worktree === "string")) {
            return { name, worktree };
        }
    }

    throw new Error("a branch must be { name: string, worktree: string | null }");
}

/** What a checkout did: the branch, and the worktree folder the session moved to, or null for a switch in place. */
export type Moved = Checkout & { worktree: string | null };

function movedFrom(value: unknown): Moved {
    const { branch: name } = checkoutFrom(value);
    const worktree: unknown = Reflect.get(Object(value), "worktree");

    if (worktree === null || typeof worktree === "string") {
        return { branch: name, worktree };
    }

    throw new Error("the worktree must be a folder, or null");
}

/** The checkout of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, Checkout | null>("git-branch", "branch", (value) =>
    value === null ? null : checkoutFrom(value),
);

/** The local branches of the session's repository. */
export const branches = actionRef<undefined, Branch[]>("git-branch", "branches", (value) => {
    if (Array.isArray(value)) {
        return value.map(branchFrom);
    }

    throw new Error("the branches must be a list");
});

/**
 * Puts the session on a local branch. A branch that another worktree has checked out moves the
 * session to that worktree's folder; any other branch is switched to in the session's own folder.
 * Git's own refusal comes back as the error.
 */
export const checkout = actionRef<Checkout, Moved>("git-branch", "checkout", movedFrom);
