import { useEffect, useEffectEvent, useRef } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedBetween } from "../lib/finished.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { toast } from "../lib/toast.ts";
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
            const id = `finished-${String(session.id)}`;

            toast.success(
                <a
                    href={sessionHref(session.id)}
                    onClick={(event) => {
                        if (isPlainClick(event)) {
                            event.preventDefault();
                            toast.dismiss(id);
                            onOpen(session.id);
                        }
                    }}
                    className="block truncate after:absolute after:inset-0 after:content-['']"
                >
                    {session.title ?? "New session"}
                </a>,
                {
                    id,
                    position: "top-right",
                    duration: 6000,
                    description: `Finished · ${folderName(session.cwd)}`,
                },
            );
        }

        before.current = after;
    });

    useEffect(() => {
        announce(sessions);
    }, [sessions]);
}
