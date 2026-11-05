/**
 * The folder picker's paths, and the keyboard over its two lists. Keys move the caret, which is the
 * selection: the rows are native buttons, so a mouse press and a focus are the same thing.
 */

/** A folder as the server names folders: an absolute path, and no trailing slash. */
export function bareFolder(path: string): string {
    return path === "/" ? path : path.replace(/\/+$/, "");
}

/** The folder one step up, or null at the root: the picker opens there, on the current folder's row. */
export function parentOf(path: string): string | null {
    const full = bareFolder(path);

    if (full === "" || full === "/") {
        return null;
    }

    const cut = full.lastIndexOf("/");

    // A relative path names no folder above it, so the picker keeps it as the one on screen.
    return cut === -1 ? null : cut === 0 ? "/" : full.slice(0, cut);
}

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
