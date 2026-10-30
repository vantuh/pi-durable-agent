import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { sessionsOf } from "./api.ts";
import { reopenDelay } from "./stream.ts";

/** Every session, as the server streams it; the setter is for a change shown before the server confirms it. */
export function useSessionList(): {
    sessions: SessionSummary[];
    setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
    connected: boolean;
} {
    const [rows, setRows] = useState<SessionSummary[]>([]);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let source: EventSource | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failures = 0;

        // A stream the browser closes for good is opened again from here: it retries only a connection it lost.
        const connect = (): void => {
            const stream = new EventSource("/api/sessions/events");

            source = stream;
            stream.onopen = () => {
                failures = 0;
                setConnected(true);
            };
            stream.onerror = () => {
                setConnected(false);

                // Anything else is the browser reconnecting on its own, and it does that better than this would.
                if (stream.readyState !== EventSource.CLOSED) {
                    return;
                }

                timer = setTimeout(connect, reopenDelay(failures));
                failures += 1;
            };
            stream.onmessage = (message: MessageEvent<string>) => {
                setRows(sessionsOf(JSON.parse(message.data)));
            };
        };

        connect();

        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }

            source?.close();
        };
    }, []);

    return { sessions: rows, setSessions: setRows, connected };
}
