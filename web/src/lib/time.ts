export const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// Building a formatter costs far more than formatting with one, and a list asks once per row.
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

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

    return SHORT_DATE.format(at);
}
