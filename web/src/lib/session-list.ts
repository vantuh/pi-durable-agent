import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { sessionsOf } from "./api.ts";

/** Every session, as the server streams it; the setter is for a change shown before the server confirms it. */
export function useSessionList(): {
    sessions: SessionSummary[];
    setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
    connected: boolean;
} {
    const [rows, setRows] = useState<SessionSummary[]>([]);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const source = new EventSource("/api/sessions/events");

        source.onopen = () => {
            setConnected(true);
        };
        source.onerror = () => {
            setConnected(false);
        };
        source.onmessage = (message: MessageEvent<string>) => {
            setRows(sessionsOf(JSON.parse(message.data)));
        };

        return () => {
            source.close();
        };
    }, []);

    return { sessions: rows, setSessions: setRows, connected };
}
