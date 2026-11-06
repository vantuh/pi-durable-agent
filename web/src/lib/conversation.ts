import { useCallback, useEffect, useRef, useState } from "react";

import type { SendMode } from "../../../shared/protocol.ts";
import { refreshExtensions } from "../extensions.ts";
import { conversationStreamPath, fetchHistory, sendMessage, stopRun } from "./api.ts";
import { type ConversationState, START, withEvent, withOlder } from "./conversation-state.ts";
import { parseEvent } from "./event.ts";
import { openStream } from "./stream.ts";
import { toast } from "./toast.ts";

export function useConversation(session: number | null): {
    state: ConversationState;
    /** Resolves true when the server took the message; false when it refused it or did not answer. */
    send: (text: string, files: string[], mode?: SendMode) => Promise<boolean>;
    stop: () => Promise<void>;
    /** Fetches the page older than the oldest entry on screen; nothing happens while one is on its way. */
    loadOlder: (settled: () => Promise<void>) => Promise<void>;
} {
    const [state, setState] = useState<ConversationState>(START);
    const asking = useRef(false);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        return openStream(conversationStreamPath(session), {
            onMessage: (data) => {
                const event = parseEvent(data);

                if (event !== undefined && event.session === session) {
                    if (event.type === "extension-notice") {
                        toast[event.notice.level](event.notice.message);
                        void refreshExtensions();
                    } else {
                        setState((current) => withEvent(current, event));
                    }
                }
            },
        });
    }, [session]);

    // The stream only answers for its own conversation: another one's state is not shown for a frame.
    const shown = state.session === session ? state : START;

    const send = useCallback(
        async (text: string, files: string[], mode?: SendMode): Promise<boolean> => {
            if (session === null) {
                return false;
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

                return accepted;
            } catch {
                setState((current) => ({ ...current, issue: "the server did not answer" }));

                return false;
            }
        },
        [session],
    );

    const loadOlder = useCallback(
        async (settled: () => Promise<void>) => {
            const before = state.entries[0]?.id;

            if (session === null || before === undefined || state.exhausted || asking.current) {
                return;
            }

            asking.current = true;

            try {
                const page = await fetchHistory(session, before);

                await settled();

                setState((current) =>
                    current.session === session && page !== undefined
                        ? withOlder(current, page)
                        : current,
                );
            } catch {
                setState((current) => ({
                    ...current,
                    issue: "the older messages did not arrive",
                }));
            } finally {
                asking.current = false;
            }
        },
        [session, state.entries, state.exhausted],
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

    return { state: shown, send, stop, loadOlder };
}
