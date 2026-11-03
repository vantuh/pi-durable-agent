import type { SessionSummary } from "../../../shared/protocol.ts";

/**
 * Newest activity first, as every list of sessions draws them. A session that has never been
 * worked in has no `activeAt` and goes last; equal times keep the order they arrived in.
 */
export function newestFirst(left: SessionSummary, right: SessionSummary): number {
    return (right.activeAt ?? 0) - (left.activeAt ?? 0);
}
