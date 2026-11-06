import { applyDiffLayout, DIFF_LAYOUT_KEY } from "@/lib/diff-layout.ts";

// Keep the old choice only when Appearance has no saved layout of its own.
if (typeof window !== "undefined" && localStorage.getItem(DIFF_LAYOUT_KEY) === null) {
    const previous = localStorage.getItem("git-history:diff-style");
    if (previous === "unified" || previous === "split") {
        applyDiffLayout(previous);
    }
}
const VIEWED = "git-history:viewed";
const SEEN = "git-history:seen";
/** The commits a folder remembers as opened: enough for the 200 the list can load, plus a branch's worth. */
const SEEN_CAPPED = 500;

const TREE_WIDTH = "git-history:tree-width";
export const USUAL_TREE_WIDTH = 240;
const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 464;

/** Capped at 40% of the screen as the sidebar is, so the diff keeps room; the column cannot be hidden. */
export function clampTreeWidth(wanted: number): number {
    const max = Math.min(MAX_TREE_WIDTH, Math.max(USUAL_TREE_WIDTH, innerWidth * 0.4));

    return Math.round(Math.min(max, Math.max(MIN_TREE_WIDTH, wanted)));
}

export function savedTreeWidth(): number {
    const width = Number(localStorage.getItem(TREE_WIDTH));

    return clampTreeWidth(width > 0 ? width : USUAL_TREE_WIDTH);
}

/** `null` forgets the saved width. */
export function saveTreeWidth(width: number | null): void {
    if (width === null) {
        localStorage.removeItem(TREE_WIDTH);
    } else {
        localStorage.setItem(TREE_WIDTH, String(width));
    }
}

/**
 * The commit last opened in a folder: the row the list rings, so someone reading ten commits knows where
 * they stopped, and it is kept across a reload. Keyed by folder, since a conversation is not the folder.
 */
export function viewedCommit(repo: string): string | null {
    return localStorage.getItem(`${VIEWED}:${repo}`);
}

export function setViewedCommit(repo: string, target: string): void {
    localStorage.setItem(`${VIEWED}:${repo}`, target);
}

/** The commits opened in a folder, so the list can tick the ones already read. */
export function seenCommits(repo: string): ReadonlySet<string> {
    const stored = localStorage.getItem(`${SEEN}:${repo}`);

    if (stored === null) {
        return new Set();
    }

    try {
        const value: unknown = JSON.parse(stored);

        return new Set(
            Array.isArray(value)
                ? value.filter((each: unknown): each is string => typeof each === "string")
                : [],
        );
    } catch {
        return new Set();
    }
}

/** Adds one commit to the folder's read list, newest first, and returns the whole of it. */
export function markSeen(
    repo: string,
    target: string,
    seen: ReadonlySet<string>,
): ReadonlySet<string> {
    const next = [target, ...[...seen].filter((each) => each !== target)].slice(0, SEEN_CAPPED);

    localStorage.setItem(`${SEEN}:${repo}`, JSON.stringify(next));

    return new Set(next);
}

/** Removes one commit from the folder's read list: its tick was pressed to take it back. */
export function unmarkSeen(
    repo: string,
    target: string,
    seen: ReadonlySet<string>,
): ReadonlySet<string> {
    const next = [...seen].filter((each) => each !== target);

    localStorage.setItem(`${SEEN}:${repo}`, JSON.stringify(next));

    return new Set(next);
}
