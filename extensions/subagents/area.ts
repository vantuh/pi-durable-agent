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

/** When each agent's run ended, by session, for those whose end is known. */
export function endedAtOf(
    agents: Iterable<{ session: number; endedAt: number | null }>,
): Map<number, number> {
    const ended = new Map<number, number>();

    for (const { session, endedAt } of agents) {
        if (endedAt !== null) {
            ended.set(session, endedAt);
        }
    }

    return ended;
}

/**
 * The agents a session started: the working ones first, then the finished ones, newest first. A
 * finished agent is placed by when its run ended (`ended`, by session) where that is known, else by
 * `activeAt`, which for an agent is about when it was started and so is never later than its end.
 */
export function agentsOf(
    parent: number,
    sessions: readonly SessionSummary[],
    ended: ReadonlyMap<number, number> = new Map(),
): SessionSummary[] {
    const time = (session: SessionSummary): number =>
        ended.get(session.id) ?? session.activeAt ?? 0;

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

/** What the row of a finished agent says; nothing when the session has no time. */
export function finishedAgo(at: number | null, now: number): string {
    if (at === null) {
        return "finished";
    }

    return now - at < MINUTE ? "finished just now" : `finished ${age(at, now)} ago`;
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
