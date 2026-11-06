/**
 * The history page's keyboard: the arrows over the list's rows, the arrows over a commit's diff, and
 * Escape out of either. Browser-safe, no imports: the page draws it and the tests hold it still.
 */

/** Where the page is: the list, one commit (or the working tree), or a review of one. */
type Where = "list" | "commit" | "review";

export type PageKeyboard = {
    where: Where;
    /** The press as `KeyboardEvent.key`: `ArrowUp`, `ArrowDown`, `Escape`, or anything else. */
    key: string;
    /** A modifier is held: a quicker scroller's arrow, or a field's selection, never the cursor. */
    modified: boolean;
    /** A field, a form, a dialog or a terminal nearer the focus holds the keys. */
    held: boolean;
    /** An input method is in the middle of a word. */
    composing: boolean;
    /** Something nearer the focus has already answered the press. */
    taken: boolean;
};

export type PageStep =
    | { kind: "none" }
    /** Escape at the list: back to the conversation. */
    | { kind: "close" }
    /** Escape in a commit or its review: back to the list, or to the commit under the review. */
    | { kind: "back" }
    /** The list's cursor moves one row. */
    | { kind: "move"; by: 1 | -1 }
    /** The detail scrolls a couple of lines, its own scroller the one that moves. */
    | { kind: "scroll"; by: 1 | -1 };

const NONE: PageStep = { kind: "none" };

/** What one press does on the page. Enter is the row button's own: a row in focus opens with it. */
export function pageStep(input: PageKeyboard): PageStep {
    if (input.held || input.composing || input.taken || input.modified) {
        return NONE;
    }

    if (input.key === "Escape") {
        return input.where === "list" ? { kind: "close" } : { kind: "back" };
    }

    if (input.key !== "ArrowUp" && input.key !== "ArrowDown") {
        return NONE;
    }

    const by = input.key === "ArrowDown" ? 1 : -1;

    if (input.where === "list") {
        return { kind: "move", by };
    }

    // A review scrolls itself, in its own frame.
    return input.where === "commit" ? { kind: "scroll", by } : NONE;
}

// A field being typed into, an open dialog, a form with a draft in it, or a surface that takes every key of its own.
const HOLDS =
    'input, textarea, select, form, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [data-own-keys]';

/** Whether something nearer the focus holds the key: a field, a dialog, a form, or a terminal. */
export function heldBy(target: Element | null): boolean {
    return target !== null && target.closest(HOLDS) !== null;
}

/** The row `by` steps from the one in focus, wrapping at the ends: neither arrow is a dead end. */
export function nextRow<T extends Element>(
    rows: readonly T[],
    from: Element | null,
    by: 1 | -1,
): T | undefined {
    if (rows.length === 0) {
        return undefined;
    }

    const at = rows.findIndex((row) => row === from);

    if (at === -1) {
        return rows[by > 0 ? 0 : rows.length - 1];
    }

    return rows[(at + by + rows.length) % rows.length];
}

/** The row the list lands on when it opens: the one it rings if that row is drawn, else its first. */
export function landingRow(
    drawn: readonly string[],
    remembered: string | undefined,
): string | undefined {
    return remembered !== undefined && drawn.includes(remembered) ? remembered : drawn[0];
}
