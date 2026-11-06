import type { SessionSummary } from "../../../shared/protocol.ts";

/** Whether the session's own run is busy, or any session started from it, at any depth, is. */
export function working(row: SessionSummary, rows: SessionSummary[]): boolean {
    // A parent chain is a tree, so the recursion ends; `seen` only guards a list that loops.
    const walk = (at: SessionSummary, seen: Set<number>): boolean =>
        at.busy ||
        rows.some(
            (child) =>
                child.parent === at.id &&
                !seen.has(child.id) &&
                walk(child, new Set(seen).add(child.id)),
        );

    return walk(row, new Set([row.id]));
}

/** The sessions that stopped working between two lists, except the one on screen: that one is already in view. */
export function finishedBetween(
    before: SessionSummary[],
    after: SessionSummary[],
    current: number | null,
): SessionSummary[] {
    const was = new Set(before.filter((row) => working(row, before)).map((row) => row.id));

    return after.filter((row) => was.has(row.id) && !working(row, after) && row.id !== current);
}
