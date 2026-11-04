/**
 * The blocks of a live frame, cut to what one client does not hold yet. A streamed answer only grows at its end, so
 * the text a client holds is usually a start of the text now; when it is not (a retry rewrote it, a new answer began)
 * the block goes whole and the client replaces it. A tool call never changes once dispatched, so one the client holds
 * with the same id, name and arguments goes without them. Correctness rests on these checks alone, so no case of the
 * harness has to be known here.
 */

import type { ClientBlock } from "../shared/protocol.ts";

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
 * The list a live frame must carry (the queue, the extension status fields), or `undefined` when the client already
 * holds it. A list that emptied is `[]`, never absent, or the client would keep showing a withdrawn item. An absent
 * list and `[]` are the same list.
 */
export function listSince<T>(held: readonly T[], list: readonly T[] | undefined): T[] | undefined {
    const now = list ?? [];

    return JSON.stringify(held) === JSON.stringify(now) ? undefined : [...now];
}
