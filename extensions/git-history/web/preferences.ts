export type DiffStyle = "unified" | "split";

const STYLE = "git-history:diff-style";
const TREE = "git-history:changed-files";
const VIEWED = "git-history:viewed";
const SEEN = "git-history:seen";
/** The commits a folder remembers as opened: enough for the 200 the list can load, plus a branch's worth. */
const SEEN_CAPPED = 500;

export function diffStyle(): DiffStyle {
    return localStorage.getItem(STYLE) === "split" ? "split" : "unified";
}

export function setDiffStyle(value: DiffStyle): void {
    localStorage.setItem(STYLE, value);
    window.dispatchEvent(new Event(STYLE));
}

export function subscribeDiffStyle(listener: () => void): () => void {
    return subscribe(STYLE, listener);
}

/** The changed-files column starts shown; a person who hid it keeps it hidden. */
export function changedFilesShown(): boolean {
    return localStorage.getItem(TREE) !== "hidden";
}

export function setChangedFilesShown(shown: boolean): void {
    localStorage.setItem(TREE, shown ? "shown" : "hidden");
    window.dispatchEvent(new Event(TREE));
}

export function subscribeChangedFiles(listener: () => void): () => void {
    return subscribe(TREE, listener);
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

function subscribe(key: string, listener: () => void): () => void {
    window.addEventListener(key, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(key, listener);
        window.removeEventListener("storage", listener);
    };
}
