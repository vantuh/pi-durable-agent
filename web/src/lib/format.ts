/**
 * A token count as one short word: 947, 1k, 1.5k, 46k, 250k, 1M, 1.5M. Exact under a thousand; one
 * decimal of k under ten thousand, whole k to a million, one decimal of M past it. A trailing ".0" is
 * dropped, and a rounding that reaches the next unit says it there, so 999_999 is "1M", not "1000k".
 */
export function tokens(count: number): string {
    const value = Math.max(0, Math.round(count));

    if (value < 1000) {
        return String(value);
    }

    if (value < 1_000_000) {
        const thousands = value < 10_000 ? trim(value / 1000) : String(Math.round(value / 1000));

        return thousands === "1000" ? "1M" : `${thousands}k`;
    }

    return `${trim(value / 1_000_000)}M`;
}

/**
 * Dollars as one short word: nothing spent is "$0", under a dollar keeps the fractions that say it was
 * spent at all ("$0.004"), and past a dollar the cents are enough ("$1.50").
 */
export function cost(dollars: number): string {
    if (dollars === 0) {
        return "$0";
    }

    return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}

/**
 * A model's own name, without its provider: a chip or a badge has room for that, and the provider goes
 * in the hover title.
 */
export function shortModel(model: string): string {
    return model.slice(model.indexOf("/") + 1);
}

/** One decimal, without a trailing ".0": 1.5, 1, 12. */
function trim(value: number): string {
    return value.toFixed(1).replace(/\.0$/, "");
}

export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));

    if (seconds < 60) {
        return `${String(seconds)}s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${String(minutes)}m ${String(seconds % 60)}s`;
    }

    return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
