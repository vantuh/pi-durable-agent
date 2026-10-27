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

/** Working, finished and not seen yet, or idle: the same mark in every list. */
export function StateMark({ session }: { session: SessionSummary }) {
    const { busy, unseen } = session;

    return (
        <span
            role={busy || unseen ? "status" : undefined}
            aria-label={busy ? "Working" : unseen ? "Finished, not viewed" : undefined}
            className={`state-mark ${busy ? "working text-accent" : unseen ? "fresh text-ok" : "idle text-faint"}`}
        />
    );
}
