import { actionRef } from "../../shared/extension-api.ts";

export type Commit = {
    hash: string;
    short: string;
    subject: string;
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
export type Changes = { title: string; files: ChangedFile[]; patch: string; truncated: boolean };
export type ReviewState = {
    id: string;
    target: string;
    state: "starting" | "running" | "done" | "failed" | "cancelled";
    decision?: "approved" | "annotated" | "dismissed";
    message?: string;
    error?: string;
    url?: string;
};

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
const number = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
function isCommit(value: unknown): value is Commit {
    return (
        object(value) &&
        typeof value["hash"] === "string" &&
        typeof value["short"] === "string" &&
        typeof value["subject"] === "string" &&
        typeof value["author"] === "string" &&
        number(value["at"]) &&
        typeof value["unpushed"] === "boolean" &&
        typeof value["remote"] === "boolean"
    );
}
function parseHistory(value: unknown): History {
    if (
        object(value) &&
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
        object(value) &&
        typeof value["path"] === "string" &&
        number(value["added"]) &&
        number(value["deleted"]) &&
        typeof value["binary"] === "boolean"
    );
}
function parseChanges(value: unknown): Changes {
    if (
        object(value) &&
        typeof value["title"] === "string" &&
        typeof value["patch"] === "string" &&
        typeof value["truncated"] === "boolean" &&
        Array.isArray(value["files"]) &&
        value["files"].every(isFile)
    ) {
        return {
            title: value["title"],
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
    if (!object(value) || typeof value["id"] !== "string" || typeof value["target"] !== "string") {
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
