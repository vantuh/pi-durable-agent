import { actionRef } from "../../shared/extension-api.ts";

/** The branch of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, string | null>("git-branch", "branch", (value) => {
    if (typeof value === "string" || value === null) {
        return value;
    }

    throw new Error("the branch must be a string or null");
});
