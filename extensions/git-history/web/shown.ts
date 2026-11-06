import type { Commit } from "../refs.ts";
import { actionTarget } from "./place.ts";

/**
 * What the open place names, and what the page knows about it: the working tree, a commit whose message
 * is at hand, a sha still being looked up, or one this folder's history does not have.
 */
export type Shown =
    | { kind: "working" }
    | { kind: "commit"; commit: Commit }
    | { kind: "reading" }
    | { kind: "missing" }
    | { kind: "error"; error: string };

/** What the page made of a target it read on its own: the commit, no such commit, or a read that failed. */
export type Looked =
    | { target: string; kind: "commit"; commit: Commit }
    | { target: string; kind: "missing" }
    | { target: string; kind: "error"; error: string };

/** The detail of the address's target: a commit from the loaded list, or one read on its own. */
export function detailOf(target: string, listed: Commit | undefined, looked: Looked | null): Shown {
    if (actionTarget(target) === "worktree") {
        return { kind: "working" };
    }
    if (listed !== undefined) {
        return { kind: "commit", commit: listed };
    }
    if (looked === null || looked.target !== target) {
        return { kind: "reading" };
    }
    return looked;
}
