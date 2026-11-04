import { actionRef } from "../../shared/extension-api.ts";

/** Where a session's folder is checked out: its branch. */
export type Checkout = { branch: string };

function checkoutFrom(value: unknown): Checkout {
    if (typeof value === "object" && value !== null) {
        const name: unknown = Reflect.get(value, "branch");

        if (typeof name === "string") {
            return { branch: name };
        }
    }

    throw new Error("the checkout must be a branch");
}

/** The checkout of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, Checkout | null>("git-branch", "branch", (value) =>
    value === null ? null : checkoutFrom(value),
);

/** The local branches of the session's folder. */
export const branches = actionRef<undefined, string[]>("git-branch", "branches", (value) => {
    if (Array.isArray(value) && value.every((name) => typeof name === "string")) {
        return value.map(String);
    }

    throw new Error("the branches must be a list of names");
});

/** Switches the session's folder to a local branch. Git's own refusal comes back as the error. */
export const checkout = actionRef<Checkout, Checkout>("git-branch", "checkout", checkoutFrom);
