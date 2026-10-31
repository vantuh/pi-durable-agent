/**
 * The blocks of a live frame, cut to what one client does not hold yet. A streamed answer only grows at its end, so
 * the text a client holds is usually a start of the text now; when it is not (a retry rewrote it, a new answer began)
 * the block goes whole and the client replaces it. Correctness rests on that check alone, so no case of the harness
 * has to be known here.
 */

import type { ClientBlock } from "../shared/protocol.ts";

export function blocksSince(
    held: readonly ClientBlock[],
    blocks: readonly ClientBlock[],
): ClientBlock[] {
    return blocks.map((block, at) => {
        const known = held[at];

        if (block.type === "toolCall" || known === undefined || known.type !== block.type) {
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
