import { actionRef } from "../../shared/extension-api.ts";

/** Where a session's folder is checked out: its branch. */
export type Checkout = { branch: string };

/** The checkout of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, Checkout | null>("git-branch", "branch", (value) => {
    if (value === null) {
        return null;
    }

    if (typeof value === "object") {
        const name: unknown = Reflect.get(value, "branch");

        if (typeof name === "string") {
            return { branch: name };
        }
    }

    throw new Error("the checkout must be a branch, or null");
});
