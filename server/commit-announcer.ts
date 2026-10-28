import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitView } from "./extensions.ts";

/**
 * Builds the function that turns a commit into a `CommitView`. The caller passes `busy` as it was at
 * the commit, because the cwd lookup is asynchronous and a later commit must not rewrite it.
 */
export function commitAnnouncer(options: {
    cwdOf: (session: number) => Promise<string | null>;
    ownerOf: (session: number) => Promise<number | undefined>;
    publish: (view: CommitView) => void;
}): (session: number, entries: readonly EntryRecord[], busy: boolean) => Promise<void> {
    // Neither changes over a session's life: its folder is fixed at creation and its owner is immutable.
    const facts = new Map<number, Promise<readonly [string | null, number | undefined]>>();

    return async (session, entries, busy) => {
        let known = facts.get(session);

        if (known === undefined) {
            known = Promise.all([options.cwdOf(session), options.ownerOf(session)]);
            facts.set(session, known);
        }

        try {
            const [cwd, owner] = await known;

            options.publish({
                session: { id: session, cwd, ...(owner === undefined ? {} : { owner }) },
                entries,
                busy,
            });
        } catch {
            facts.delete(session);
        }
    };
}
