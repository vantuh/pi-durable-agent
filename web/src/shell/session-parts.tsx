import type { ReactNode } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";

export const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Elapsed time as one short unit: "now", "5m", "2h", "3d"; a date past a week. */
export function ago(at: number, now: number): string {
    const elapsed = Math.max(0, now - at);

    if (elapsed < MINUTE) {
        return "now";
    }

    if (elapsed < HOUR) {
        return `${String(Math.floor(elapsed / MINUTE))}m`;
    }

    if (elapsed < DAY) {
        return `${String(Math.floor(elapsed / HOUR))}h`;
    }

    if (elapsed < 7 * DAY) {
        return `${String(Math.floor(elapsed / DAY))}d`;
    }

    return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function folderName(cwd: string | null): string {
    if (cwd === null || cwd === "") {
        return "no folder";
    }

    const parts = cwd.split("/");

    return parts[parts.length - 1] ?? cwd;
}

/**
 * Working, held by an extension, finished and not seen yet, or idle: the same mark in every list.
 * A session that is not working itself while `working` of the sessions it started are gets the
 * working mark in the agent colour, so its row does not look idle.
 */
export function StateMark({ session, working = 0 }: { session: SessionSummary; working?: number }) {
    const { busy, unseen, mark } = session;
    const delegated = mark === undefined && !busy && working > 0;
    const note = delegated
        ? `${String(working)} ${working === 1 ? "agent" : "agents"} working`
        : undefined;
    const label =
        mark ?? (busy ? "Working" : (note ?? (unseen ? "Finished, not viewed" : undefined)));

    return (
        <span
            role={label === undefined ? undefined : "status"}
            aria-label={label}
            title={mark ?? note}
            className={`state-mark ${
                mark !== undefined
                    ? "held text-warn"
                    : busy
                      ? "working text-accent"
                      : delegated
                        ? "working text-agent"
                        : unseen
                          ? "fresh text-ok"
                          : "idle text-faint"
            }`}
        />
    );
}

/**
 * A row of a list across folders: mark, title over folder, and time. The caller makes it a link.
 * `trailing` sits between the title and the time, inside the same line.
 */
export function SessionRowContent({
    session,
    now,
    trailing,
}: {
    session: SessionSummary;
    now: number;
    trailing?: ReactNode;
}) {
    return (
        <>
            <StateMark session={session} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sidebar text-ink truncate">
                    {session.title ?? "New session"}
                </span>
                <span className="text-meta text-faint truncate font-mono">
                    {folderName(session.cwd)}
                </span>
            </span>
            {trailing}
            <span className="text-meta text-faint min-w-7 shrink-0 text-right">
                {session.activeAt === null ? null : ago(session.activeAt, now)}
            </span>
        </>
    );
}
