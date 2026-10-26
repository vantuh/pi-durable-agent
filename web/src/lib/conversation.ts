import { useCallback, useEffect, useState } from "react";

import type { ClientEntry, ClientLive, ServerEvent } from "../../../shared/protocol.ts";
import { type Health, getHealth, sendMessage, stopRun } from "./api.ts";
import { parseEvent } from "./event.ts";

export type ConversationState = {
    connected: boolean;
    model: string;
    entries: ClientEntry[];
    live: ClientLive;
    issue: string | null;
};

const IDLE: ClientLive = { busy: false, usage: { input: 0, output: 0, cost: 0 } };

const START: ConversationState = {
    connected: false,
    model: "",
    entries: [],
    live: IDLE,
    issue: null,
};

/** The tail rule of the stream, in one place: entries grow unless the server rewrote them. */
function withEvent(state: ConversationState, event: ServerEvent): ConversationState {
    switch (event.type) {
        case "hello":
            return { ...state, entries: event.entries, live: event.live, model: event.model };

        case "entries":
            return {
                ...state,
                entries: event.replace ? event.entries : [...state.entries, ...event.entries],
            };

        case "live":
            return { ...state, live: event.live };

        case "error":
            return { ...state, issue: event.message };

        default:
            return state;
    }
}

export function useConversation(): {
    state: ConversationState;
    health: Health | undefined;
    send: (text: string) => Promise<void>;
    stop: () => Promise<void>;
} {
    const [state, setState] = useState<ConversationState>(START);
    const [health, setHealth] = useState<Health | undefined>(undefined);

    useEffect(() => {
        const source = new EventSource("/api/events");

        source.onopen = () => {
            setState((current) => ({ ...current, connected: true }));
        };
        source.onerror = () => {
            setState((current) => ({ ...current, connected: false }));
        };
        source.onmessage = (message: MessageEvent<string>) => {
            const event = parseEvent(message.data);

            if (event !== undefined) {
                setState((current) => withEvent(current, event));
            }
        };

        return () => {
            source.close();
        };
    }, []);

    useEffect(() => {
        void getHealth().then(setHealth, () => {
            setHealth(undefined);
        });
    }, []);

    const send = useCallback(async (text: string) => {
        setState((current) => ({ ...current, issue: null }));

        try {
            const accepted = await sendMessage(text);

            if (!accepted) {
                setState((current) => ({ ...current, issue: "the server refused the message" }));
            }
        } catch {
            setState((current) => ({ ...current, issue: "the server did not answer" }));
        }
    }, []);

    const stop = useCallback(async () => {
        try {
            await stopRun();
        } catch {
            setState((current) => ({ ...current, issue: "the server did not answer" }));
        }
    }, []);

    return { state, health, send, stop };
}
