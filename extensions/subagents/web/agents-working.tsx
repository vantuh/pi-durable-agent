import type { StatusItemProps } from "@/sdk/types.ts";
import { CountSuffix } from "@/ui/count-suffix.tsx";

import { workingAgentCount } from "./area.ts";

// After the session counts, as in the approved mockup. The open agent is not counted.
export function AgentsWorking({ session, sessions }: StatusItemProps) {
    const count = workingAgentCount(sessions, session?.id ?? null);

    if (count === 0) {
        return null;
    }

    return (
        <span className="text-warn shrink-0">
            · {count}
            <CountSuffix>{` ${count === 1 ? "agent" : "agents"} working`}</CountSuffix>
        </span>
    );
}
