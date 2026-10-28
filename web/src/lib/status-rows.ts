import type { SessionSummary } from "../../../shared/protocol.ts";
import { sidebarSessions } from "./session-nesting.ts";

function newestFirst(left: SessionSummary, right: SessionSummary): number {
    return (right.activeAt ?? 0) - (left.activeAt ?? 0);
}

/**
 * What the status popover lists besides the open session. A session started from another is left
 * out, as in the sidebar: whoever started it counts it. `hasMarker` says an extension put a marker
 * on the row; such a row is listed while its session is idle, and does not count as working.
 */
export function statusRows(
    all: readonly SessionSummary[],
    current: number | null,
    hasMarker: (session: SessionSummary) => boolean,
): { working: SessionSummary[]; marked: SessionSummary[]; unseen: SessionSummary[] } {
    const listed = sidebarSessions(all).filter(
        (session) => !session.archived && session.id !== current,
    );
    const working = listed.filter((session) => session.busy).toSorted(newestFirst);
    const marked = listed
        .filter((session) => !session.busy && hasMarker(session))
        .toSorted(newestFirst);
    const unseen = listed
        .filter((session) => session.unseen && !session.busy && !marked.includes(session))
        .toSorted(newestFirst);

    return { working, marked, unseen };
}
