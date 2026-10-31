/**
 * The blocks of a live frame, cut to what one client does not hold yet. A streamed answer only grows at its end, so
 * the text a client holds is usually a start of the text now; when it is not (a retry rewrote it, a new answer began)
 * the block goes whole and the client replaces it. A tool call never changes once dispatched, so one the client holds
 * with the same id, name and arguments goes without them. Correctness rests on these checks alone, so no case of the
 * harness has to be known here.
 */

import type { ClientBlock, ClientQueued, ClientStatus } from "../shared/protocol.ts";

export function blocksSince(
    held: readonly ClientBlock[],
    blocks: readonly ClientBlock[],
): ClientBlock[] {
    return blocks.map((block, at) => {
        const known = held[at];

        if (block.type === "toolCall") {
            return known?.type === "toolCall" &&
                known.id === block.id &&
                known.name === block.name &&
                JSON.stringify(known.args) === JSON.stringify(block.args)
                ? { type: "toolCall", id: block.id, name: block.name }
                : block;
        }

        if (known === undefined || known.type !== block.type) {
            return block;
        }

        return known.text !== "" && block.text.startsWith(known.text)
            ? {
                  type: block.type,
                  text: block.text.slice(known.text.length),
                  from: known.text.length,
              }
            : block;
    });
}

/**
 * The queue a live frame must carry, or `undefined` when the client already holds it. A queue that emptied is `[]`,
 * never absent, or the client would keep showing a withdrawn message. An absent queue and `[]` are the same queue.
 */
export function queuedSince(
    held: readonly ClientQueued[],
    queued: readonly ClientQueued[] | undefined,
): ClientQueued[] | undefined {
    const now = queued ?? [];

    return JSON.stringify(held) === JSON.stringify(now) ? undefined : [...now];
}

/**
 * The extension status fields a live frame must carry, or `undefined` when the client already holds them. Fields
 * that emptied are `[]`, never absent, or the client would keep showing a withdrawn field. An absent status and `[]`
 * are the same status.
 */
export function statusSince(
    held: readonly ClientStatus[],
    status: readonly ClientStatus[] | undefined,
): ClientStatus[] | undefined {
    const now = status ?? [];

    return JSON.stringify(held) === JSON.stringify(now) ? undefined : [...now];
}
