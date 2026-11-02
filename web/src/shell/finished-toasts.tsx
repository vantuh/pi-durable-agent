import { useEffect, useEffectEvent, useRef } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedBetween } from "../lib/finished.ts";
import { showSessionAlert } from "./session-alert.tsx";
import { folderName } from "./session-parts.tsx";

/** A toast when another session's run ends; a click anywhere on it opens that session. */
export function useFinishedToasts(
    sessions: SessionSummary[],
    current: number | null,
    onOpen: (id: number) => void,
): void {
    const before = useRef<SessionSummary[]>([]);
    const announce = useEffectEvent((after: SessionSummary[]) => {
        for (const session of finishedBetween(before.current, after, current)) {
            showSessionAlert(
                {
                    id: `finished-${String(session.id)}`,
                    level: "success",
                    session: session.id,
                    title: session.title ?? "New session",
                    description: `Finished · ${folderName(session.cwd)}`,
                },
                onOpen,
            );
        }

        before.current = after;
    });

    useEffect(() => {
        announce(sessions);
    }, [sessions]);
}
