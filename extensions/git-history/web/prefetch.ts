import { loadChanges } from "./patch-cache.ts";

/**
 * Pierre's diff view and its shiki warm-up are 630 kB of client code that only the open page draws, so the
 * module is fetched when a commit opens: at boot it would be downloaded for a page that may never open.
 */
export const loadPreview = () => import("./preview.tsx");

export const PREFETCHED = 3;
const HOVER_DELAY = 120;

/** Reading is half the wait; parsing and highlighting otherwise start on the click. */
export async function prefetch(session: number, target: string): Promise<void> {
    const found = await loadChanges(session, target);
    const { warmPreview } = await loadPreview();
    await warmPreview(found.patch);
}

/** Sweeping the mouse down the list must not read every commit it crosses. */
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
export function prefetchSoon(session: number, target: string | undefined): void {
    clearTimeout(hoverTimer);
    if (target === undefined) {
        return;
    }
    hoverTimer = setTimeout(() => {
        void prefetch(session, target).catch(() => undefined);
    }, HOVER_DELAY);
}

export function whenIdle(run: () => void): () => void {
    if (typeof requestIdleCallback !== "function") {
        const timer = setTimeout(run, 200);
        return () => {
            clearTimeout(timer);
        };
    }
    const handle = requestIdleCallback(run, { timeout: 1500 });
    return () => {
        cancelIdleCallback(handle);
    };
}
