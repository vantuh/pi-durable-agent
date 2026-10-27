/**
 * The transcript beyond the browser's window. `main.ts` streams the active view, and that view starts at the newest
 * head marker: everything a compaction set aside, the start of a long conversation, is only in the entry log. This
 * file pages that log back, one turn at a time, so the screen can ask for what it has not got yet.
 */

import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Cursor } from "@earendil-works/pi-durable";

import type { ClientEntry, ClientHistory } from "../shared/protocol.ts";
import { projectEntry } from "./projection.ts";

/** Entries read from storage in one scan, and the most one answer holds before it stops and says there is more. */
const CHUNK = 40;
const PAGE_MAX = 400;

/** Whether the log keeps entries older than `id`: what `hello` answers the screen about paging. */
export async function hasOlder(options: {
    conversation: Conversation;
    context: Context;
    id: number;
}): Promise<boolean> {
    const oldest = await options.conversation.entries(
        { order: "ascending" },
        1,
        undefined,
        options.context,
    );
    const first = oldest.items[0];

    return first !== undefined && Number(first.id) < options.id;
}

export async function historyPage(options: {
    conversation: Conversation;
    context: Context;
    /** The newest entry the browser already has; everything at or above it is left out. */
    before?: number;
}): Promise<ClientHistory> {
    const { conversation, context, before } = options;
    const collected: ClientEntry[] = [];
    let cursor: Cursor | undefined;

    for (;;) {
        const page = await conversation.entries({ order: "descending" }, CHUNK, cursor, context);

        for (const record of page.items) {
            const entry = projectEntry(record);

            if (entry !== undefined && (before === undefined || Number(record.id) < before)) {
                collected.push(entry);
            }
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
