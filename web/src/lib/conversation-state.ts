/**
 * What the screen holds, kept in step with the server. This is the reducer of the event stream, on its own so it can be
 * run without a browser: entries are immutable and the log only grows, so the list is an upsert by id. A compaction
 * rewrites the active view and the server answers with a shorter list, but the entries the browser already has are
 * still the conversation — dropping them is what made a long session lose its start.
 */

import type { ClientEntry, ClientLive, ServerEvent } from "../../../shared/protocol.ts";

export type ConversationState = {
    session: number | null;
    connected: boolean;
    model: string;
    entries: ClientEntry[];
    live: ClientLive;
    issue: string | null;
};

export const IDLE: ClientLive = { busy: false, usage: { input: 0, output: 0, cost: 0 } };

export const START: ConversationState = {
    session: null,
    connected: false,
    model: "",
    entries: [],
    live: IDLE,
    issue: null,
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

export function withEvent(state: ConversationState, event: ServerEvent): ConversationState {
    switch (event.type) {
        case "hello":
            return {
                ...state,
                session: event.session,
                entries: mergeEntries([], event.entries),
                live: event.live,
                model: event.model,
            };

        case "entries":
            return { ...state, entries: mergeEntries(state.entries, event.entries) };

        case "live":
            return { ...state, live: event.live };

        case "extension-notice":
            return state;

        case "error":
            return { ...state, issue: event.message };

        default:
            return state;
    }
}
