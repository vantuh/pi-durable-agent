import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { StatusProps } from "@/sdk/types.ts";

import { state, type WorktreeState } from "../refs.ts";

/**
 * The worktree of the open session, read again whenever the run state changes: the session keeps no
 * word of its own that it was a worktree, so the server answers instead.
 */
export function useWorktree(session: StatusProps["session"]): {
    worktree: WorktreeState | null;
    setWorktree: (worktree: WorktreeState | null) => void;
} {
    const [found, setFound] = useState<WorktreeState | null>(null);
    const id = session?.id ?? null;
    const cwd = session?.cwd ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        let alive = true;

        void (async () => {
            let read: WorktreeState | null = null;

            try {
                read = cwd === null ? null : await callAction(state, { cwd }, id);
            } catch {
                read = null;
            }

            if (alive) {
                setFound(read);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run ending (busy going false), and a change its own commits do not show, are when the folder may have gone
    }, [id, cwd, busy, session?.revision]);

    return { worktree: found, setWorktree: setFound };
}
