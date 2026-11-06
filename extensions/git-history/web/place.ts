import { WORKING } from "../refs.ts";

const HASH = /^[0-9a-f]{4,64}$/i;

/** A place in the page: the list, one commit (or the working tree), or a review of it. */
export type Place =
    | { kind: "list" }
    | { kind: "commit"; target: string }
    | { kind: "review"; target: string };

/** The address's `sub` as a place; anything else falls back to the list. */
export function placeOf(sub: string | undefined): Place {
    if (sub === undefined) {
        return { kind: "list" };
    }

    const [first, ...rest] = sub.split("/");
    const target = first === undefined ? undefined : targetOfSub(first);

    if (target === undefined) {
        return { kind: "list" };
    }

    if (rest.length === 0) {
        return { kind: "commit", target };
    }

    return rest.length === 1 && rest[0] === "review"
        ? { kind: "review", target }
        : { kind: "list" };
}

function targetOfSub(sub: string): string | undefined {
    return sub === WORKING || HASH.test(sub) ? sub : undefined;
}

/** The action's name for a place's target. */
export const actionTarget = (target: string): string => (target === WORKING ? "worktree" : target);

/** The address's name for a review's target. */
export const subTarget = (target: string): string => (target === "worktree" ? WORKING : target);
