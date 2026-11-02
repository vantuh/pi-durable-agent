export const DIFF_LAYOUTS = ["unified", "split"] as const;

export type DiffLayout = (typeof DIFF_LAYOUTS)[number];

const KEY = "diff-layout";

export function currentDiffLayout(): DiffLayout {
    const stored = localStorage.getItem(KEY);

    return DIFF_LAYOUTS.find((layout) => layout === stored) ?? "unified";
}

export function applyDiffLayout(layout: DiffLayout): void {
    localStorage.setItem(KEY, layout);
    window.dispatchEvent(new Event(KEY));
}

export function watchDiffLayout(notify: () => void): () => void {
    window.addEventListener(KEY, notify);
    window.addEventListener("storage", notify);

    return () => {
        window.removeEventListener(KEY, notify);
        window.removeEventListener("storage", notify);
    };
}
