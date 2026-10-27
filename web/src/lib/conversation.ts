import { useCallback, useEffect, useState } from "react";

import type { ClientEntry, ClientLive, SendMode, ServerEvent } from "../../../shared/protocol.ts";
import { refreshExtensions } from "../extensions.ts";
import { sendMessage, stopRun } from "./api.ts";
import { parseEvent } from "./event.ts";
import { toast } from "./toast.ts";

export type ConversationState = {
    session: number | null;
    connected: boolean;
    model: string;
    entries: ClientEntry[];
    live: ClientLive;
    issue: string | null;
};

const IDLE: ClientLive = { busy: false, usage: { input: 0, output: 0, cost: 0 } };

const START: ConversationState = {
    session: null,
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
            return {
                ...state,
                session: event.session,
                entries: event.entries,
                live: event.live,
                model: event.model,
            };

        case "entries":
            return {
                ...state,
                entries: event.replace ? event.entries : [...state.entries, ...event.entries],
            };

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

export function useConversation(session: number | null): {
    state: ConversationState;
    send: (text: string, files: string[], mode?: SendMode) => Promise<void>;
    stop: () => Promise<void>;
} {
    const [state, setState] = useState<ConversationState>(START);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        const source = new EventSource(`/api/events?session=${String(session)}`);

        source.onopen = () => {
            setState((current) => ({ ...current, connected: true }));
        };
        source.onerror = () => {
            setState((current) => ({ ...current, connected: false }));
        };
        source.onmessage = (message: MessageEvent<string>) => {
            const event = parseEvent(message.data);

            if (event !== undefined && event.session === session) {
                if (event.type === "extension-notice") {
                    toast[event.notice.level](event.notice.message);
                    void refreshExtensions();
                } else {
                    setState((current) => withEvent(current, event));
                }
            }
        };

        return () => {
            source.close();
        };
    }, [session]);

    // The stream only answers for its own conversation: another one's state is not shown for a frame.
    const shown = state.session === session ? state : START;

    const send = useCallback(
        async (text: string, files: string[], mode?: SendMode) => {
            if (session === null) {
                return;
            }

            setState((current) => ({ ...current, issue: null }));

            try {
                const accepted = await sendMessage(session, text, files, mode);

                if (!accepted) {
                    setState((current) => ({
                        ...current,
                        issue: "the server refused the message",
                    }));
                }
            } catch {
                setState((current) => ({ ...current, issue: "the server did not answer" }));
            }
        },
        [session],
    );

    const stop = useCallback(async () => {
        if (session === null) {
            return;
        }

        try {
            await stopRun(session);
        } catch {
            setState((current) => ({ ...current, issue: "the server did not answer" }));
        }
    }, [session]);

    return { state: shown, send, stop };
}
