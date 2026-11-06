import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { agents, type NamedAgent } from "../refs.ts";

// The records change only when an agent is added; the key also moves when one finishes, which
// heals a list that arrived before the record did.
export function useNames(
    parent: number | null,
    kids: readonly SessionSummary[],
): Map<number, NamedAgent> {
    const [found, setFound] = useState<{ parent: number; named: NamedAgent[] } | null>(null);
    const key = kids.map((kid) => `${String(kid.id)}${kid.busy ? "+" : "-"}`).join();

    useEffect(() => {
        if (parent === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            try {
                const named = await callAction(agents, undefined, parent);

                if (alive) {
                    setFound({ parent, named });
                }
            } catch {
                // The titles stand in for the names.
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the key stands for the children
    }, [parent, key]);

    return new Map(
        (found !== null && found.parent === parent ? found.named : []).map((named) => [
            named.session,
            named,
        ]),
    );
}
