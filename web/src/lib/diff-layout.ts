export const DIFF_LAYOUTS = ["unified", "split"] as const;

export type DiffLayout = (typeof DIFF_LAYOUTS)[number];

export const DIFF_LAYOUT_KEY = "diff-layout";

export function currentDiffLayout(): DiffLayout {
    const stored = localStorage.getItem(DIFF_LAYOUT_KEY);

    return DIFF_LAYOUTS.find((layout) => layout === stored) ?? "unified";
}

export function applyDiffLayout(layout: DiffLayout): void {
    localStorage.setItem(DIFF_LAYOUT_KEY, layout);
    window.dispatchEvent(new Event(DIFF_LAYOUT_KEY));
}

export function watchDiffLayout(notify: () => void): () => void {
    window.addEventListener(DIFF_LAYOUT_KEY, notify);
    window.addEventListener("storage", notify);

    return () => {
        window.removeEventListener(DIFF_LAYOUT_KEY, notify);
        window.removeEventListener("storage", notify);
    };
}
