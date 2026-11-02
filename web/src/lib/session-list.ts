import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react";

import type {
    ExtensionNotice,
    SessionListEvent,
    SessionSummary,
    SessionsEvent,
} from "../../../shared/protocol.ts";
import { sessionsEventOf } from "./api.ts";
import { reopenDelay } from "./stream.ts";

/**
 * The list after one frame of the stream: a `sessions` frame replaces it, a `rows` frame upserts the rows it
 * carries and drops the ids it says are gone. The sidebar sorts and groups by itself, so the order is nothing
 * this has to keep.
 */
export function withSessionsEvent(
    current: SessionSummary[],
    event: SessionListEvent,
): SessionSummary[] {
    if (event.type === "sessions") {
        return event.sessions;
    }

    const rows = new Map(current.map((row) => [row.id, row]));

    for (const id of event.gone) {
        rows.delete(id);
    }

    for (const row of event.rows) {
        rows.set(row.id, row);
    }

    return [...rows.values()];
}

/**
 * Every session, as the server streams it; the setter is for a change shown before the server confirms it. A
 * notice an extension sends about a session rides the same stream, since this one is open whether or not a
 * session is on screen: `onNotice` gets it, and the shell decides whether to say it.
 */
export function useSessionList(onNotice?: (notice: ExtensionNotice) => void): {
    sessions: SessionSummary[];
    setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
    connected: boolean;
} {
    const [rows, setRows] = useState<SessionSummary[]>([]);
    const [connected, setConnected] = useState(false);
    const announce = useEffectEvent((notice: ExtensionNotice) => {
        onNotice?.(notice);
    });

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
                const event: SessionsEvent = sessionsEventOf(JSON.parse(message.data));

                if (event.type === "extension-notice") {
                    announce(event.notice);

                    return;
                }

                setRows((current) => withSessionsEvent(current, event));
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
