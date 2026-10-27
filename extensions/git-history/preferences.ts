export type DiffStyle = "unified" | "split";

const KEY = "git-history:diff-style";

export function diffStyle(): DiffStyle {
    return localStorage.getItem(KEY) === "split" ? "split" : "unified";
}

export function setDiffStyle(value: DiffStyle): void {
    localStorage.setItem(KEY, value);
    window.dispatchEvent(new Event(KEY));
}

export function subscribeDiffStyle(listener: () => void): () => void {
    window.addEventListener(KEY, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(KEY, listener);
        window.removeEventListener("storage", listener);
    };
}
