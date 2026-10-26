/**
 * An edit's diff as data: the display diff `pi-durable`'s edit tool writes (`+12 text`, `-12 text`, ` 12 text`, and
 * `   ...` where it skips lines) parsed into lines, and in each changed pair the words that differ.
 */

export type DiffSpan = { text: string; changed: boolean };

export type DiffLine =
    | { type: "add" | "del" | "ctx"; num: number; spans: DiffSpan[] }
    | { type: "skip"; text: string };

const LINE = /^([+\- ])\s*(\d+) (.*)$/;

/** Words, the spaces between them, and each punctuation mark: the units a change is found in. */
const tokensOf = (text: string): string[] => text.match(/\w+|\s+|[^\w\s]/g) ?? [];

/**
 * What changed between a removed line and the line that replaced it: the tokens between their common start and their
 * common end. A pair with almost nothing in common is shown whole, not as confetti.
 */
export function wordDiff(before: string, after: string): { del: DiffSpan[]; add: DiffSpan[] } {
    const a = tokensOf(before);
    const b = tokensOf(after);
    let start = 0;

    while (start < a.length && start < b.length && a[start] === b[start]) {
        start++;
    }

    let end = 0;

    while (
        end < a.length - start &&
        end < b.length - start &&
        a[a.length - 1 - end] === b[b.length - 1 - end]
    ) {
        end++;
    }

    const spans = (tokens: string[]): DiffSpan[] =>
        [
            { text: tokens.slice(0, start).join(""), changed: false },
            { text: tokens.slice(start, tokens.length - end).join(""), changed: true },
            { text: tokens.slice(tokens.length - end).join(""), changed: false },
        ].filter((span) => span.text !== "");
    const kept = a.slice(0, start).join("").length + a.slice(a.length - end).join("").length;

    if (kept < Math.min(before.length, after.length) / 3) {
        return { del: [{ text: before, changed: false }], add: [{ text: after, changed: false }] };
    }

    return { del: spans(a), add: spans(b) };
}

export function parseDiff(diff: string): DiffLine[] {
    const lines: DiffLine[] = [];
    // The tool numbers a context line by the old file; shown beside added lines, it takes the new file's number.
    let shift = 0;

    for (const raw of diff.split("\n")) {
        const match = LINE.exec(raw);

        if (match === null) {
            if (raw.trim() !== "") {
                lines.push({ type: "skip", text: raw.trim() });
            }

            continue;
        }

        const sign = match[1];
        const text = match[3] ?? "";

        const type = sign === "+" ? "add" : sign === "-" ? "del" : "ctx";

        lines.push({
            type,
            num: Number(match[2]) + (type === "ctx" ? shift : 0),
            spans: [{ text, changed: false }],
        });
        shift += type === "add" ? 1 : type === "del" ? -1 : 0;
    }

    // A run of removed lines and the run of added lines after it: line by line, the words that changed.
    for (let at = 0; at < lines.length;) {
        let dels = at;

        while (lines[dels]?.type === "del") {
            dels++;
        }

        let adds = dels;

        while (lines[adds]?.type === "add") {
            adds++;
        }

        for (let pair = 0; pair < Math.min(dels - at, adds - dels); pair++) {
            const del = lines[at + pair];
            const add = lines[dels + pair];

            if (
                del !== undefined &&
                add !== undefined &&
                del.type !== "skip" &&
                add.type !== "skip"
            ) {
                const changed = wordDiff(del.spans[0]?.text ?? "", add.spans[0]?.text ?? "");

                del.spans = changed.del;
                add.spans = changed.add;
            }
        }

        at = Math.max(adds, at + 1);
    }

    return lines;
}

/** A run of a line in one colour: the highlighter's class, and whether it is among the words that changed. */
export type DiffPiece = { text: string; changed: boolean; className?: string };

/**
 * A line's changed spans cut again where its highlighted tokens begin and end, so each piece has one colour and one
 * diff state. Tokens that do not spell the line (a highlighter that read it otherwise) are left out.
 */
export function piecesOf(
    spans: DiffSpan[],
    tokens: { text: string; className: string }[] | undefined,
): DiffPiece[] {
    const line = spans.map((span) => span.text).join("");

    if (tokens === undefined || tokens.map((token) => token.text).join("") !== line) {
        return spans;
    }

    const pieces: DiffPiece[] = [];
    let span = 0;
    let inSpan = 0;

    for (const token of tokens) {
        let rest = token.text;

        while (rest !== "") {
            const current = spans[span];

            if (current === undefined) {
                break;
            }

            const take = Math.min(rest.length, current.text.length - inSpan);

            pieces.push({
                text: rest.slice(0, take),
                changed: current.changed,
                className: token.className,
            });
            rest = rest.slice(take);
            inSpan += take;

            if (inSpan === current.text.length) {
                span++;
                inSpan = 0;
            }
        }
    }

    return pieces;
}

/** Lines added and removed, as the diff counts them. */
export function diffCounts(diff: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;

    for (const line of parseDiff(diff)) {
        added += line.type === "add" ? 1 : 0;
        removed += line.type === "del" ? 1 : 0;
    }

    return { added, removed };
}
