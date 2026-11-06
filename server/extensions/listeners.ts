/** Handing a commit, or a session that is gone, to the listeners of one extension version. */

import type { CommitListener, CommitView, SessionGoneListener } from "./contract.ts";

/** A listener that throws or rejects is logged without its error, and the others still run. */
export function deliverCommit(
    log: (message: string) => void,
    folder: string,
    listeners: readonly CommitListener[],
    view: CommitView,
): void {
    for (const listener of listeners) {
        try {
            void Promise.resolve(listener(view)).catch(() => {
                log(`extensions: ${folder}: commit listener rejected`);
            });
        } catch {
            log(`extensions: ${folder}: commit listener threw`);
        }
    }
}

export function deliverGone(
    log: (message: string) => void,
    folder: string,
    listeners: readonly SessionGoneListener[],
    session: number,
): void {
    for (const listener of listeners) {
        try {
            void Promise.resolve(listener(session)).catch(() => {
                log(`extensions: ${folder}: session-gone listener rejected`);
            });
        } catch {
            log(`extensions: ${folder}: session-gone listener threw`);
        }
    }
}
