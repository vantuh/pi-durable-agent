import type { SessionSummary } from "../../../shared/protocol.ts";

/** The sessions whose run ended between two lists, except the one on screen: that one is already in view. */
export function finishedBetween(
    before: SessionSummary[],
    after: SessionSummary[],
    current: number | null,
): SessionSummary[] {
    const working = new Set(before.filter((row) => row.busy).map((row) => row.id));

    return after.filter((row) => working.has(row.id) && !row.busy && row.id !== current);
}
