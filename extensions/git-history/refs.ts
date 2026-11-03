import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

/** Listing untracked files costs a Git process each, so a preview stops here and says it did. */
export const UNTRACKED_FILE_CAP = 500;

export type Commit = {
    hash: string;
    short: string;
    subject: string;
    body: string;
    author: string;
    at: number;
    unpushed: boolean;
    remote: boolean;
};
export type History = {
    branch: string;
    upstream: string | null;
    ahead: number;
    behind: number;
    changes: number;
    commits: Commit[];
    more: boolean;
};
export type ChangedFile = { path: string; added: number; deleted: number; binary: boolean };
export type Changes = { files: ChangedFile[]; patch: string; truncated: boolean };
export type ReviewState = {
    id: string;
    target: string;
    state: "starting" | "running" | "done" | "failed" | "cancelled";
    decision?: "approved" | "annotated" | "dismissed";
    message?: string;
    error?: string;
    url?: string;
};

const number = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
function isCommit(value: unknown): value is Commit {
    return (
        isRecord(value) &&
        typeof value["hash"] === "string" &&
        typeof value["short"] === "string" &&
        typeof value["subject"] === "string" &&
        typeof value["body"] === "string" &&
        typeof value["author"] === "string" &&
        number(value["at"]) &&
        typeof value["unpushed"] === "boolean" &&
        typeof value["remote"] === "boolean"
    );
}
function parseHistory(value: unknown): History {
    if (
        isRecord(value) &&
        typeof value["branch"] === "string" &&
        (value["upstream"] === null || typeof value["upstream"] === "string") &&
        number(value["ahead"]) &&
        number(value["behind"]) &&
        number(value["changes"]) &&
        typeof value["more"] === "boolean" &&
        Array.isArray(value["commits"]) &&
        value["commits"].every(isCommit)
    ) {
        return {
            branch: value["branch"],
            upstream: value["upstream"],
            ahead: value["ahead"],
            behind: value["behind"],
            changes: value["changes"],
            more: value["more"],
            commits: value["commits"],
        };
    }
    throw new Error("Invalid Git history response");
}
function isFile(value: unknown): value is ChangedFile {
    return (
        isRecord(value) &&
        typeof value["path"] === "string" &&
        number(value["added"]) &&
        number(value["deleted"]) &&
        typeof value["binary"] === "boolean"
    );
}
function parseChanges(value: unknown): Changes {
    if (
        isRecord(value) &&
        typeof value["patch"] === "string" &&
        typeof value["truncated"] === "boolean" &&
        Array.isArray(value["files"]) &&
        value["files"].every(isFile)
    ) {
        return {
            patch: value["patch"],
            truncated: value["truncated"],
            files: value["files"],
        };
    }
    throw new Error("Invalid changes response");
}
export function parseReview(value: unknown): ReviewState | null {
    if (value === null) {
        return null;
    }
    if (
        !isRecord(value) ||
        typeof value["id"] !== "string" ||
        typeof value["target"] !== "string"
    ) {
        throw new Error("Invalid review response");
    }
    const state = value["state"];
    if (
        state !== "starting" &&
        state !== "running" &&
        state !== "done" &&
        state !== "failed" &&
        state !== "cancelled"
    ) {
        throw new Error("Invalid review state");
    }
    const result: ReviewState = { id: value["id"], target: value["target"], state };
    for (const key of ["message", "error", "url"] as const) {
        const found = value[key];
        if (found !== undefined) {
            if (typeof found !== "string") {
                throw new Error(`Invalid review ${key}`);
            }
            result[key] = found;
        }
    }
    const decision = value["decision"];
    if (decision === "approved" || decision === "annotated" || decision === "dismissed") {
        result.decision = decision;
    }
    return result;
}
export type Reword = { hash: string };
function parseReword(value: unknown): Reword {
    if (isRecord(value) && typeof value["hash"] === "string") {
        return { hash: value["hash"] };
    }
    throw new Error("Invalid reword response");
}
export const history = actionRef<{ limit: number }, History>(
    "git-history",
    "history",
    parseHistory,
);
export const changes = actionRef<{ target: string }, Changes>(
    "git-history",
    "changes",
    parseChanges,
);
function parseCommit(value: unknown): Commit | null {
    if (value === null || isCommit(value)) {
        return value;
    }
    throw new Error("Invalid commit response");
}
/**
 * One commit's message, for a link that names a commit the loaded page of history stops short of.
 * `null` is that history not having the sha; a thrown error is a read that did not happen.
 */
export const commitMeta = actionRef<{ target: string }, Commit | null>(
    "git-history",
    "commit",
    parseCommit,
);
export const start = actionRef<{ target: string }, ReviewState | null>(
    "git-history",
    "start",
    parseReview,
);
export const review = actionRef<undefined, ReviewState | null>(
    "git-history",
    "review",
    parseReview,
);
export const cancel = actionRef<{ id: string }, ReviewState | null>(
    "git-history",
    "cancel",
    parseReview,
);
export const reword = actionRef<{ hash: string; subject: string; body: string }, Reword>(
    "git-history",
    "reword",
    parseReword,
);
