/** Every word of the query has to match, in any order, so "log fix" finds "Fix login". */
const START_BONUS = 4;
const NEAR_PENALTY = 1;
const GAP_PENALTY = 2;

function wordScore(text: string, word: string): number | null {
    const at = text.indexOf(word);

    if (at >= 0) {
        const startsWord = at === 0 || text[at - 1] === " " || text[at - 1] === "-";

        return word.length + (startsWord ? START_BONUS : 0) - at * 0.1;
    }

    // No substring: the letters may still come in order, further apart meaning a worse match.
    let cursor = 0;
    let score = 0;
    let previous = -1;

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
    }

    return score;
}

/**
 * How well a title matches the search box; `null` means it does not, so it is not shown.
 * An empty query matches everything with the same score.
 */
export function fuzzyScore(title: string, query: string): number | null {
    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== "");

    if (words.length === 0) {
        return 0;
    }

    const text = title.toLowerCase();
    let total = 0;

    for (const word of words) {
        const score = wordScore(text, word);

        if (score === null) {
            return null;
        }

        total += score;
    }

    return total;
}
