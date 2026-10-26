import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitView } from "./extensions.ts";

/**
 * Builds the function that turns a commit into a `CommitView`. The caller passes `busy` as it was at
 * the commit, because the cwd lookup is asynchronous and a later commit must not rewrite it.
 */
export function commitAnnouncer(options: {
    cwdOf: (session: number) => Promise<string | null>;
    publish: (view: CommitView) => void;
}): (session: number, entries: readonly EntryRecord[], busy: boolean) => Promise<void> {
    const cwds = new Map<number, Promise<string | null>>();

    return async (session, entries, busy) => {
        let cwd = cwds.get(session);

        if (cwd === undefined) {
            cwd = options.cwdOf(session);
            cwds.set(session, cwd);
        }

        try {
            options.publish({ session: { id: session, cwd: await cwd }, entries, busy });
        } catch {
            cwds.delete(session);
        }
    };
}
