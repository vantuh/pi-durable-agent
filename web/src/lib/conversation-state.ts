/**
 * What the screen holds, kept in step with the server. This is the reducer of the event stream, on its own so it can be
 * run without a browser: entries are immutable and the log only grows, so the list is an upsert by id. A compaction
 * rewrites the active view and the server answers with a shorter list, but the entries the browser already has are
 * still the conversation — dropping them is what made a long session lose its start.
 */

import type {
    ClientBlock,
    ClientEntry,
    ClientHistory,
    ClientLive,
    ServerEvent,
} from "../../../shared/protocol.ts";

export type ConversationState = {
    session: number | null;
    entries: ClientEntry[];
    live: ClientLive;
    issue: string | null;
    /** A page of older entries is being fetched for the top of the transcript. */
    loadingOlder: boolean;
    /** The conversation's first entry is on screen: there is nothing older to ask for. */
    exhausted: boolean;
};

const IDLE: ClientLive = { busy: false, usage: { input: 0, output: 0, cost: 0 } };

export const START: ConversationState = {
    session: null,
    entries: [],
    live: IDLE,
    issue: null,
    loadingOlder: false,
    exhausted: false,
};

export function mergeEntries(
    loaded: ClientEntry[],
    incoming: readonly ClientEntry[],
): ClientEntry[] {
    if (incoming.length === 0) {
        return loaded;
    }

    const byId = new Map(loaded.map((entry) => [entry.id, entry]));

    for (const entry of incoming) {
        byId.set(entry.id, entry);
    }

    // Ids are minted in commit order, and a compaction marker carries the id it was written with: the screen's order is
    // the log's order, not the order the events happened to arrive in.
    return [...byId.values()].sort((left, right) => left.id - right.id);
}

/**
 * The blocks a `live` frame leaves on screen: each block is the one the frame carries, with the end of the text the
 * screen held at its position put in front when the frame carries only the end, and a tool call without `args` has
 * those of the call the screen held there, if that is the same call. The frame lists every block, so
 * whatever the screen held beyond the last one is gone, and a frame with none clears them all.
 */
function withBlocks(
    held: readonly ClientBlock[] | undefined,
    incoming: readonly ClientBlock[],
): ClientBlock[] {
    return incoming.map((block, at) => {
        const known = held?.[at];

        if (block.type === "toolCall") {
            return !("args" in block) && known?.type === "toolCall" && known.id === block.id
                ? { ...block, args: known.args }
                : block;
        }

        const before =
            block.from !== undefined && block.from > 0 && known?.type === block.type
                ? known.text.slice(0, block.from)
                : "";

        return { type: block.type, text: before + block.text };
    });
}

export function withEvent(state: ConversationState, event: ServerEvent): ConversationState {
    switch (event.type) {
        case "hello": {
            // A reconnect repeats hello for the conversation already on screen, carrying only the newest page: the pages
            // read before it stay, and a start already reached stays reached.
            const same = state.session === event.session;

            return {
                ...state,
                session: event.session,
                entries: mergeEntries(same ? state.entries : [], event.entries),
                live: event.live,
                loadingOlder: same ? state.loadingOlder : false,
                exhausted: same ? state.exhausted || !event.more : !event.more,
                issue: null,
            };
        }

        case "entries":
            return { ...state, entries: mergeEntries(state.entries, event.entries) };

        case "live": {
            const { blocks, ...rest } = event.live;
            // An absent `queued` is the queue the client holds; the server sends `[]` when it emptied.
            const queued = "queued" in rest ? rest.queued : state.live.queued;

            return {
                ...state,
                live: {
                    ...rest,
                    ...(queued === undefined ? {} : { queued }),
                    ...(blocks === undefined
                        ? {}
                        : { blocks: withBlocks(state.live.blocks, blocks) }),
                },
            };
        }

        case "extension-notice":
            return state;

        default:
            return state;
    }
}

/** A page of older entries, from `/api/history`: added in front, and the end of the conversation is where it says. */
export function withOlder(state: ConversationState, page: ClientHistory): ConversationState {
    return {
        ...state,
        entries: mergeEntries(state.entries, page.entries),
        loadingOlder: false,
        exhausted: !page.more,
    };
}
