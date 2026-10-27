import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { sessionsOf } from "./api.ts";

/** Every session, as the server streams it; the setter is for a change shown before the server confirms it. */
export function useSessionList(): [SessionSummary[], Dispatch<SetStateAction<SessionSummary[]>>] {
    const [rows, setRows] = useState<SessionSummary[]>([]);

    useEffect(() => {
        const source = new EventSource("/api/sessions/events");

        source.onmessage = (message: MessageEvent<string>) => {
            setRows(sessionsOf(JSON.parse(message.data)));
        };

        return () => {
            source.close();
        };
    }, []);

    return [rows, setRows];
}
