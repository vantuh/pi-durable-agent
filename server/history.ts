/**
 * The transcript beyond the browser's window. `main.ts` streams the view, a window of the newest 50 to 100 entries,
 * and everything older is only in the entry log. This file pages that log back, one turn at a time, so the screen
 * can ask for what it has not got yet.
 */

import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Cursor, EntryId, EntryRecord } from "@earendil-works/pi-durable";

import type { ClientEntry, ClientHistory } from "../shared/protocol.ts";
import { projectEntry } from "./projection.ts";

/** Entries read from storage in one scan, and the most one answer holds before it stops and says there is more. */
const CHUNK = 40;
const PAGE_MAX = 400;

/** One entry of the conversation's log by id, `undefined` when this conversation has no such entry. */
export async function entryAt(options: {
    conversation: Conversation;
    context: Context;
    id: number;
}): Promise<EntryRecord | undefined> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an entry id is a number at run time; the brand lives only in the type
    const bound = options.id as EntryId;
    const page = await options.conversation.entries(
        { minEntryId: bound, maxEntryId: bound },
        1,
        undefined,
        options.context,
    );

    return page.items[0];
}

export async function historyPage(options: {
    conversation: Conversation;
    context: Context;
    /** The newest entry the browser already has; everything at or above it is left out. */
    before?: number;
}): Promise<ClientHistory> {
    const { conversation, context, before } = options;
    const collected: ClientEntry[] = [];
    // Read from below `before`, not from the newest entry down: each older page would read more.
    const query =
        before === undefined
            ? { order: "descending" as const }
            : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an entry id is a number at run time; the brand lives only in the type
              { order: "descending" as const, maxEntryId: (before - 1) as EntryId };
    let cursor: Cursor | undefined;

    for (;;) {
        const page = await conversation.entries(query, CHUNK, cursor, context);

        for (const record of page.items) {
            collected.push(projectEntry(record));
        }

        cursor = page.next;

        // A page ends at the oldest question in what was read, so a turn is never cut between its words and its answer.
        const cut = collected.findLastIndex((entry) => entry.kind === "user");

        if (cut >= 0) {
            return {
                entries: collected.slice(0, cut + 1).reverse(),
                more: cursor !== undefined || cut < collected.length - 1,
            };
        }

        if (cursor === undefined) {
            return { entries: collected.reverse(), more: false };
        }

        if (collected.length >= PAGE_MAX) {
            return { entries: collected.reverse(), more: true };
        }
    }
}
