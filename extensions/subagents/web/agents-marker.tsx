import type { StatusRowProps } from "@/sdk/types.ts";

import { agentsOf } from "./area.ts";

// Inside the row's link, so it is only a mark and a count: the core makes the whole row the trigger.
export function AgentsMarker({ session, sessions }: StatusRowProps) {
    const count = agentsOf(session.id, sessions).filter((kid) => kid.busy).length;

    return (
        <span className="text-meta text-muted flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="state-mark working text-warn" aria-hidden />
            <span aria-hidden>{count}</span>
            <span className="sr-only">
                {count} {count === 1 ? "agent" : "agents"} working
            </span>
        </span>
    );
}
