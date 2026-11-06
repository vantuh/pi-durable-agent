import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { type Strip, strip } from "../refs.ts";

// Agents run in the background, so the parent never changes when one starts, works or ends. The
// server says so through `revision` whenever one of its agents commits.
export function useStrip(session: number | null, revision: number): Strip | null {
    const [found, setFound] = useState<{ session: number; strip: Strip } | null>(null);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            let next: Strip | null = null;

            try {
                next = await callAction(strip, undefined, session);
            } catch {
                next = null;
            }

            if (alive) {
                setFound(next === null ? null : { session, strip: next });
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the revision only says "ask again"
    }, [session, revision]);

    return found !== null && found.session === session ? found.strip : null;
}
