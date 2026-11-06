// A commit row counts from now; this is the same instant spelled out in the reader's own zone.
export const EXACT_TIME = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
});
