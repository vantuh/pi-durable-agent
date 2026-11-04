export type DiffStyle = "unified" | "split";

const STYLE = "git-history:diff-style";
const TREE = "git-history:changed-files";

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

function subscribe(key: string, listener: () => void): () => void {
    window.addEventListener(key, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(key, listener);
        window.removeEventListener("storage", listener);
    };
}
