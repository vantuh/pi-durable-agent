/** What the first frame of a conversation stream carries: the newest page of the transcript, cut by bytes. */

import type { ClientEntry } from "../../shared/protocol.ts";

/**
 * The bytes one `hello` carries, newest entries first: opening a session should show the last turns, not
 * wait for its whole history. The server answers in milliseconds, so what a phone on a slow link waits for
 * is the transfer: 128 KB is about a second at 1 Mbit/s and about 35 KB gzipped, and anything older is one
 * `/api/history` page away, which the transcript asks for when it scrolls up.
 */
const HELLO_BYTES = 128 * 1024;

/** The newest entries one `hello` carries, and whether older ones were left out of the view. */
export type HelloPage = { entries: ClientEntry[]; cut: boolean };

/**
 * The newest entries that fit `HELLO_BYTES`. The newest entry is always carried, so one huge entry
 * cannot open an empty session.
 */
export function helloPage(entries: readonly ClientEntry[]): HelloPage {
    let bytes = 0;
    let start = entries.length;

    for (const entry of entries.toReversed()) {
        const size = JSON.stringify(entry).length;

        if (bytes + size > HELLO_BYTES && start < entries.length) {
            break;
        }

        bytes += size;
        start -= 1;
    }

    return { entries: entries.slice(start), cut: start > 0 };
}
