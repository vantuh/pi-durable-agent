/**
 * The keyboard over the folder picker's two lists. Keys move the caret, which is the selection: the
 * rows are native buttons, so a mouse press and a focus are the same thing.
 */

/** The rows of one list, in the order they are drawn: a row is a button that names its folder. */
export function rowsOf(list: Element | null): HTMLElement[] {
    return list === null ? [] : [...list.querySelectorAll<HTMLElement>("[data-folder]")];
}

/** The row `by` steps from the one in focus, wrapping at the ends: neither arrow is a dead end. */
export function nextRow(
    rows: readonly HTMLElement[],
    from: Element | null,
    by: number,
): HTMLElement | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    const at = rows.findIndex((row) => row === from);

    if (at === -1) {
        return rows[by > 0 ? 0 : rows.length - 1];
    }

    return rows[(at + by + rows.length) % rows.length];
}

/** The folder a target stands for: the row it sits in, not the star or the text beside it. */
export function folderAt(target: Element | null): string | undefined {
    return target?.closest("[data-folder]")?.getAttribute("data-folder") ?? undefined;
}
