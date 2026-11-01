import { useSyncExternalStore } from "react";

// What the panel and the header badge share: the open-task count of each session's note, and
// whether a panel is open on it (an open panel owns the note, so the badge does not read it).
const counts = new Map<number, number>();
const owners = new Map<number, number>();
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

/** A panel is open on this session's note; call the result when it is done with it. */
export function claim(session: number): () => void {
    owners.set(session, (owners.get(session) ?? 0) + 1);

    return () => {
        const left = (owners.get(session) ?? 1) - 1;

        if (left <= 0) {
            owners.delete(session);
        } else {
            owners.set(session, left);
        }
    };
}

export const isClaimed = (session: number): boolean => owners.has(session);
