import { useCallback, useEffect, useRef, useState } from "react";

import type { SendMode } from "../../../shared/protocol.ts";
import { refreshExtensions } from "../extensions.ts";
import { fetchHistory, sendMessage, stopRun } from "./api.ts";
import { type ConversationState, START, withEvent, withOlder } from "./conversation-state.ts";
import { parseEvent } from "./event.ts";
import { reopenDelay } from "./stream.ts";
import { toast } from "./toast.ts";

export function useConversation(session: number | null): {
    state: ConversationState;
    send: (text: string, files: string[], mode?: SendMode) => Promise<void>;
    stop: () => Promise<void>;
    /** Fetches the page older than the oldest entry on screen; nothing happens while one is on its way. */
    loadOlder: () => Promise<void>;
} {
    const [state, setState] = useState<ConversationState>(START);
    const asking = useRef(false);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        let source: EventSource | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failures = 0;

        // A stream the browser closes for good is opened again from here: it retries only a connection it lost.
        const connect = (): void => {
            const stream = new EventSource(`/api/events?session=${String(session)}`);

            source = stream;
            stream.onopen = () => {
                failures = 0;
            };
            stream.onerror = () => {
                // Anything else is the browser reconnecting on its own, and it does that better than this would.
                if (stream.readyState !== EventSource.CLOSED) {
                    return;
                }

                timer = setTimeout(connect, reopenDelay(failures));
                failures += 1;
            };
            stream.onmessage = (message: MessageEvent<string>) => {
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
        };

        connect();

        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }

            source?.close();
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

    const loadOlder = useCallback(async () => {
        const before = state.entries[0]?.id;

        if (session === null || before === undefined || state.exhausted || asking.current) {
            return;
        }

        asking.current = true;
        setState((current) => ({ ...current, loadingOlder: true }));

        try {
            const page = await fetchHistory(session, before);

            setState((current) =>
                current.session === session && page !== undefined
                    ? withOlder(current, page)
                    : { ...current, loadingOlder: false },
            );
        } catch {
            setState((current) => ({
                ...current,
                loadingOlder: false,
                issue: "the older messages did not arrive",
            }));
        } finally {
            asking.current = false;
        }
    }, [session, state.entries, state.exhausted]);

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

    return { state: shown, send, stop, loadOlder };
}
