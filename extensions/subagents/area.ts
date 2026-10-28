import type { SessionSummary } from "../../shared/protocol.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The session whose agents the sidebar area lists: the parent of the open session when it is an
 * agent, else the open session itself. Undefined for none, and for an agent whose parent is not
 * in the list (the sidebar shows such an agent as a row of its own).
 */
export function areaParent(
    open: number | null,
    sessions: readonly SessionSummary[],
): SessionSummary | undefined {
    const current = sessions.find((session) => session.id === open);

    if (current === undefined) {
        return undefined;
    }

    return current.parent === undefined
        ? current
        : sessions.find((session) => session.id === current.parent);
}

/**
 * The agents a session started: the working ones first, newest start first, then the finished ones
 * by when their run ended, newest first. A finished agent whose end is unknown goes last: `activeAt`
 * is about when an agent was started, so it says nothing of its end.
 */
export function agentsOf(parent: number, sessions: readonly SessionSummary[]): SessionSummary[] {
    const time = (session: SessionSummary): number =>
        (session.busy ? session.activeAt : session.endedAt) ?? 0;

    return sessions
        .filter((session) => session.parent === parent)
        .toSorted((a, b) => Number(b.busy) - Number(a.busy) || time(b) - time(a) || b.id - a.id);
}

/** "4m", "2h", "1d": one short unit, as the sidebar's times. */
export function age(at: number, now: number): string {
    const elapsed = Math.max(0, now - at);

    if (elapsed < HOUR) {
        return `${String(Math.floor(elapsed / MINUTE))}m`;
    }

    return elapsed < DAY
        ? `${String(Math.floor(elapsed / HOUR))}h`
        : `${String(Math.floor(elapsed / DAY))}d`;
}

/** What the row of a finished agent says: how long ago, or "finished" when the end of its run is unknown. */
export function finishedAgo(at: number | undefined, now: number): string {
    if (at === undefined) {
        return "finished";
    }

    return now - at < MINUTE ? "just now" : `${age(at, now)} ago`;
}

/** Whether a session has an agent working now: the marker in the status popover. */
export function hasWorkingAgent(
    session: SessionSummary,
    sessions: readonly SessionSummary[],
): boolean {
    return sessions.some((other) => other.parent === session.id && other.busy);
}

/**
 * The agents working now, over every session. The open one is left out, as the open session is
 * left out of the status bar's session counts.
 */
export function workingAgentCount(
    sessions: readonly SessionSummary[],
    open: number | null,
): number {
    return sessions.filter(
        (session) => session.parent !== undefined && session.busy && session.id !== open,
    ).length;
}
