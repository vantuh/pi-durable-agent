import { useSyncExternalStore } from "react";

/** The tab the Terminal page has on screen now, and its folder; null while the page is not open. */
let shown: { cwd: string; tab: number } | null = null;
const listeners = new Set<() => void>();

export function showTab(next: { cwd: string; tab: number } | null): void {
    shown = next;

    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

/** The folder's tab on screen now, or null when the Terminal page shows none of its tabs. */
export function useShownTab(cwd: string): number | null {
    const now = useSyncExternalStore(subscribe, () => shown);

    return now?.cwd === cwd ? now.tab : null;
}
