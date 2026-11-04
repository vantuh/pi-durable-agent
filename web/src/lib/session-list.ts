import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react";

import type {
    ExtensionNotice,
    SessionListEvent,
    SessionSummary,
    SessionsEvent,
} from "../../../shared/protocol.ts";
import { sessionsEventOf } from "./api.ts";
import { openStream } from "./stream.ts";

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

    useEffect(
        () =>
            openStream("/api/sessions/events", {
                onOpen: () => {
                    setConnected(true);
                },
                onError: () => {
                    setConnected(false);
                },
                onMessage: (data) => {
                    const event: SessionsEvent = sessionsEventOf(JSON.parse(data));

                    if (event.type === "extension-notice") {
                        announce(event.notice);

                        return;
                    }

                    setRows((current) => withSessionsEvent(current, event));
                },
            }),
        [],
    );

    return { sessions: rows, setSessions: setRows, connected };
}
