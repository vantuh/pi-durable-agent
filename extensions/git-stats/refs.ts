import { actionRef } from "../../shared/extension-api.ts";

export type GitStats = {
    added: number;
    deleted: number;
    ahead: number;
    behind: number;
    upstream: string | null;
};

function parse(value: unknown): GitStats | null {
    if (value === null) {
        return null;
    }
    if (
        typeof value === "object" &&
        "added" in value &&
        typeof value.added === "number" &&
        "deleted" in value &&
        typeof value.deleted === "number" &&
        "ahead" in value &&
        typeof value.ahead === "number" &&
        "behind" in value &&
        typeof value.behind === "number" &&
        "upstream" in value &&
        (typeof value.upstream === "string" || value.upstream === null)
    ) {
        return {
            added: value.added,
            deleted: value.deleted,
            ahead: value.ahead,
            behind: value.behind,
            upstream: value.upstream,
        };
    }
    throw new Error("Invalid Git statistics");
}

export const stats = actionRef<undefined, GitStats | null>("git-stats", "stats", parse);
export const push = actionRef<undefined, GitStats | null>("git-stats", "push", parse);
