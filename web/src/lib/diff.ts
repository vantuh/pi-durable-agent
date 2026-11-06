const LINE = /^([+\- ]) *(\d+) (.*)$/;

/** Convert Pi's numbered display diff to a partial unified patch without filling omitted context. */
export function editPatch(
    diff: string,
): { patch: string; added: number; removed: number; note?: string } | undefined {
    const hunks: string[] = [];
    let current:
        | {
              oldStart: number;
              newStart: number;
              oldCount: number;
              newCount: number;
              lines: string[];
          }
        | undefined;
    let added = 0;
    let removed = 0;
    let note: string | undefined;
    let oldEnd = 1;
    let newEnd = 1;

    const finish = () => {
        if (current !== undefined) {
            const { oldStart, newStart, oldCount, newCount, lines } = current;
            hunks.push(
                `@@ -${String(oldStart - (oldCount === 0 ? 1 : 0))},${String(oldCount)} +${String(newStart - (newCount === 0 ? 1 : 0))},${String(newCount)} @@\n${lines.join("\n")}`,
            );
            oldEnd = oldStart + oldCount;
            newEnd = newStart + newCount;
            current = undefined;
        }
    };

    const rows = diff.split("\n");
    for (const [index, raw] of rows.entries()) {
        if (raw === "" && index === rows.length - 1) {
            continue;
        }
        if (note !== undefined) {
            return undefined;
        }
        if (/^ +\.\.\.$/.test(raw)) {
            finish();
            continue;
        }
        if (/^ … \d+ more lines$/.test(raw)) {
            note = raw.trim();
            finish();
            continue;
        }

        const match = LINE.exec(raw);
        if (match === null) {
            return undefined;
        }
        const sign = match[1];
        const number = Number(match[2]);
        const shift = added - removed;
        if (!Number.isSafeInteger(number) || number < 1) {
            return undefined;
        }
        current ??= {
            oldStart: sign === "+" ? number - shift : number,
            newStart: sign === "+" ? number : number + shift,
            oldCount: 0,
            newCount: 0,
            lines: [],
        };
        if (
            !Number.isSafeInteger(current.oldStart) ||
            !Number.isSafeInteger(current.newStart) ||
            current.oldStart < oldEnd ||
            current.newStart < newEnd ||
            number !==
                (sign === "+"
                    ? current.newStart + current.newCount
                    : current.oldStart + current.oldCount)
        ) {
            return undefined;
        }
        current.lines.push(`${sign}${match[3] ?? ""}`);
        if (sign !== "+") {
            current.oldCount += 1;
        }
        if (sign !== "-") {
            current.newCount += 1;
        }
        added += sign === "+" ? 1 : 0;
        removed += sign === "-" ? 1 : 0;
    }
    finish();
    if (hunks.length === 0 || added + removed === 0) {
        return undefined;
    }
    // shortcut: display diffs omit EOF newline metadata; use Pi's stored patch if exact EOF markers are needed.
    return {
        patch: `--- edit\n+++ edit\n${hunks.join("\n")}\n`,
        added,
        removed,
        ...(note === undefined ? {} : { note }),
    };
}

/** Counts use the same adapter as the card, without loading Pierre or its highlighter in the transcript summary. */
export function diffCounts(diff: string): { added: number; removed: number } | undefined {
    const adapted = editPatch(diff);
    return adapted === undefined ? undefined : { added: adapted.added, removed: adapted.removed };
}
