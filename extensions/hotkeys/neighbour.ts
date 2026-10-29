import type { SessionSummary } from "../../shared/protocol.ts";
// Relative, not `@/`, so the test can load it under node.
import { holdingRow, sidebarSessions } from "../../web/src/lib/session-nesting.ts";

/**
 * The session `step` rows from `current` in the sidebar's order (not archived, newest first),
 * wrapping round. A nested session counts as the row that holds it, an archived one as its own
 * place in the list. From home, next is the first row and previous the last.
 */
export function neighbour(
    sessions: readonly SessionSummary[],
    current: number | null,
    step: 1 | -1,
): number | null {
    const anchor = holdingRow(current, sessions) ?? current;
    const rows = sidebarSessions(sessions)
        .filter((session) => !session.archived || session.id === anchor)
        .toSorted((left, right) => (right.activeAt ?? 0) - (left.activeAt ?? 0));
    const at = rows.findIndex((session) => session.id === anchor);
    const index =
        at === -1 ? (step === 1 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length;

    return rows[index]?.id ?? null;
}
