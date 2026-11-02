import { useSyncExternalStore } from "react";

// What the panel and the header badge share: the open to-dos of each session's repository.
const counts = new Map<number, number>();
const listeners = new Set<() => void>();

const notify = (): void => {
    for (const listener of listeners) {
        listener();
    }
};

export function setCount(session: number, count: number): void {
    if (counts.get(session) !== count) {
        counts.set(session, count);
        notify();
    }
}

export function useCount(session: number | null): number {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        () => (session === null ? 0 : (counts.get(session) ?? 0)),
    );
}

let lastFlush: Promise<void> = Promise.resolve();

/** Records a save that is still running, so a read of the same note can wait for it. */
export function trackFlush(save: Promise<void>): void {
    lastFlush = save.catch(() => undefined);
}

/** Resolves once the latest tracked save has settled; never rejects. */
export const flushed = (): Promise<void> => lastFlush;
