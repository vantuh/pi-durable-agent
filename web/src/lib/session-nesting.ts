import type { SessionSummary } from "../../../shared/protocol.ts";

/**
 * Whether the sidebar leaves this session out: something other than a person started it, from a
 * session that is in `all`. Pass the full list, before any folder, archive or search filter, so a
 * filtered-out parent still hides its children. A child whose parent is gone stays in the list.
 */
export function isNested(session: SessionSummary, all: readonly SessionSummary[]): boolean {
    return session.parent !== undefined && all.some((other) => other.id === session.parent);
}

/** The sessions the sidebar can show as rows. */
export function sidebarSessions(all: readonly SessionSummary[]): SessionSummary[] {
    return all.filter((session) => !isNested(session, all));
}

/** How many sessions started from `id` are working now, over the full list. */
export function workingChildren(id: number, all: readonly SessionSummary[]): number {
    return all.filter((session) => session.parent === id && session.busy).length;
}

/** The sidebar row that holds a nested session: its nearest ancestor with a row. Null when `id` has a row itself. */
export function holdingRow(id: number | null, all: readonly SessionSummary[]): number | null {
    const byId = new Map(all.map((session) => [session.id, session]));
    const seen = new Set<number>();
    let session = id === null ? undefined : byId.get(id);

    while (session !== undefined && isNested(session, all)) {
        if (seen.has(session.id)) {
            return null;
        }

        seen.add(session.id);
        session = byId.get(session.parent ?? -1);
    }

    return seen.size === 0 ? null : (session?.id ?? null);
}
