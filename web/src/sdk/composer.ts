/** Unsent text per session. Extensions may append a draft, never send it. */
const drafts = new Map<string, string>();
const appended = new Set<string>();
const listeners = new Set<() => void>();

/** Words taken from an answer and waiting above a session's composer, oldest first. */
const quotes = new Map<string, string[]>();
const quoteListeners = new Set<() => void>();

export function composerDraft(sessionId: string): string {
    return drafts.get(sessionId) ?? "";
}

export function setComposerDraft(sessionId: string, text: string): void {
    if (text === "") {
        drafts.delete(sessionId);
    } else {
        drafts.set(sessionId, text);
    }
    for (const listener of listeners) {
        listener();
    }
}

export function appendComposerDraft(session: number, text: string, id?: string): void {
    const entry = `${String(session)}:${id ?? ""}`;
    if (id !== undefined && appended.has(entry)) {
        return;
    }
    if (id !== undefined) {
        appended.add(entry);
    }
    const key = String(session);
    const before = composerDraft(key);
    setComposerDraft(key, before.trim() === "" ? text : `${before}\n\n${text}`);
}

export function subscribeComposerDraft(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The one empty list: a reader compares snapshots, and a new array each read would look like a change. */
const NO_QUOTES: string[] = [];

export function composerQuotes(sessionId: string): string[] {
    return quotes.get(sessionId) ?? NO_QUOTES;
}

function tellQuotes(): void {
    for (const listener of quoteListeners) {
        listener();
    }
}

export function addComposerQuote(sessionId: string, text: string): void {
    const quoted = text.trim();
    const current = composerQuotes(sessionId);

    if (quoted === "" || current.includes(quoted)) {
        return;
    }

    quotes.set(sessionId, [...current, quoted]);
    tellQuotes();
}

export function removeComposerQuote(sessionId: string, index: number): void {
    const next = composerQuotes(sessionId).filter((_, at) => at !== index);

    if (next.length === 0) {
        quotes.delete(sessionId);
    } else {
        quotes.set(sessionId, next);
    }

    tellQuotes();
}

export function clearComposerQuotes(sessionId: string): void {
    quotes.delete(sessionId);
    tellQuotes();
}

export function subscribeComposerQuotes(listener: () => void): () => void {
    quoteListeners.add(listener);
    return () => {
        quoteListeners.delete(listener);
    };
}

const focusListeners = new Set<() => boolean>();

/**
 * Asks the composer on screen for the caret, so words quoted from an answer can be followed by a question.
 * Answers whether the caret landed: a composer under a page or an expanded panel is inert and takes nothing.
 */
export function focusComposer(): boolean {
    let landed = false;

    for (const listener of focusListeners) {
        landed = listener() || landed;
    }

    return landed;
}

export function subscribeComposerFocus(listener: () => boolean): () => void {
    focusListeners.add(listener);
    return () => {
        focusListeners.delete(listener);
    };
}

/** What brings the caret back unasked: a menu, sheet or panel that closed, or the window coming back. */
export type ComposerReturn = "close" | "window";

export interface ComposerScene {
    reason: ComposerReturn;
    /** Nothing holds the keyboard: the page's body, or no element at all. */
    lost: boolean;
    /** Another field, outside any menu or dialog, holds the caret. */
    typing: boolean;
    /** A menu or dialog is open. */
    overlay: boolean;
    /** A phone: the caret would raise the on-screen keyboard. */
    touch: boolean;
    /** Words are selected on the page, in the transcript for one. */
    selecting: boolean;
}

/** A close follows a click or key of the person's; a window coming back only fills a keyboard nobody holds. */
export function composerMayTakeFocus(scene: ComposerScene): boolean {
    if (scene.overlay || scene.touch || scene.typing || scene.selecting) {
        return false;
    }

    return scene.reason === "close" || scene.lost;
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** A field the person is typing in: not the composer itself, not one inside a dialog that is closing. */
export function isTypingElsewhere(active: Element | null): boolean {
    return (
        active !== null &&
        active.closest(EDITABLE) !== null &&
        active.closest('[data-slot="composer-field"]') === null &&
        active.closest(OVERLAY) === null
    );
}

/**
 * Hands the caret to the composer when nothing of the person's is in the way. The explicit request,
 * `focusComposer`, never asks; this is for the shell's own returns. Answers whether the caret landed.
 */
export function restoreComposerFocus(reason: ComposerReturn): boolean {
    const { activeElement, body } = document;
    const selection = window.getSelection();

    const allowed = composerMayTakeFocus({
        reason,
        lost: activeElement === null || activeElement === body,
        typing: isTypingElsewhere(activeElement),
        overlay: document.querySelector(`:is(${OVERLAY})[data-state="open"]`) !== null,
        touch: window.matchMedia("(pointer: coarse)").matches,
        selecting: selection !== null && !selection.isCollapsed,
    });

    return allowed && focusComposer();
}
