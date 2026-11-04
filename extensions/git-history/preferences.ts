export type DiffStyle = "unified" | "split";

const STYLE = "git-history:diff-style";
const TREE = "git-history:changed-files";
const VIEWED = "git-history:viewed";

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

function subscribe(key: string, listener: () => void): () => void {
    window.addEventListener(key, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(key, listener);
        window.removeEventListener("storage", listener);
    };
}
