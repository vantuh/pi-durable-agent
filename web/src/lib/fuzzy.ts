const START_BONUS = 4;
const NEAR_PENALTY = 1;
const GAP_PENALTY = 2;

export type FuzzyMatch = {
    score: number;
    /** `[start, end)` offsets in the title, ascending and never overlapping. */
    ranges: [number, number][];
};

export type Segment = { text: string; hit: boolean };

function wordMatch(text: string, word: string): { score: number; hits: number[] } | null {
    const at = text.indexOf(word);

    if (at >= 0) {
        const startsWord = at === 0 || text[at - 1] === " " || text[at - 1] === "-";

        return {
            score: word.length + (startsWord ? START_BONUS : 0) - at * 0.1,
            hits: Array.from({ length: word.length }, (_, index) => at + index),
        };
    }

    // No substring: the letters may still come in order, further apart meaning a worse match.
    let cursor = 0;
    let score = 0;
    let previous = -1;
    const hits: number[] = [];

    for (const letter of word) {
        const found = text.indexOf(letter, cursor);

        if (found < 0) {
            return null;
        }

        score += 1;
        score -= previous >= 0 && found === previous + 1 ? 0 : NEAR_PENALTY;
        score -= Math.min(GAP_PENALTY, found - cursor);
        cursor = found + 1;
        previous = found;
        hits.push(found);
    }

    return { score, hits };
}

function toRanges(hits: number[]): [number, number][] {
    const ranges: [number, number][] = [];

    for (const index of [...new Set(hits)].toSorted((left, right) => left - right)) {
        const last = ranges[ranges.length - 1];

        if (last !== undefined && index === last[1]) {
            last[1] = index + 1;
        } else {
            ranges.push([index, index + 1]);
        }
    }

    return ranges;
}

/**
 * How well a title matches the search box, and which characters matched; `null` means it does
 * not match, so it is not shown. An empty query matches everything with the same score.
 * Every word of the query has to match, in any order, so "log fix" finds "Fix login".
 */
export function fuzzyMatch(title: string, query: string): FuzzyMatch | null {
    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== "");

    if (words.length === 0) {
        return { score: 0, ranges: [] };
    }

    const text = title.toLowerCase();
    let score = 0;
    const hits: number[] = [];

    for (const word of words) {
        const match = wordMatch(text, word);

        if (match === null) {
            return null;
        }

        score += match.score;
        hits.push(...match.hits);
    }

    // Lowercasing a character can change its length, and the offsets would then point one off.
    return { score, ranges: text.length === title.length ? toRanges(hits) : [] };
}

/** The score alone, when the order of the list is all that is wanted. */
export function fuzzyScore(title: string, query: string): number | null {
    return fuzzyMatch(title, query)?.score ?? null;
}

/** The title cut at the matched ranges, ready to be drawn with the hits picked out. */
export function segments(title: string, ranges: [number, number][]): Segment[] {
    const parts: Segment[] = [];
    let at = 0;

    for (const [start, end] of ranges) {
        if (start > at) {
            parts.push({ text: title.slice(at, start), hit: false });
        }

        parts.push({ text: title.slice(start, end), hit: true });
        at = end;
    }

    if (at < title.length) {
        parts.push({ text: title.slice(at), hit: false });
    }

    return parts;
}
