import type { ClientStatus, ClientUsage, SessionSummary } from "../../../shared/protocol.ts";
import type { StatusProps } from "../sdk/types.ts";
import { StatusField, StatusItems } from "../ui/status-fields.tsx";

/** 394, 1.2k, 10.9k, 250k, 1.5M: one decimal while it still says something. */
function compact(count: number): string {
    const trim = (value: number): string => value.toFixed(1).replace(/\.0$/, "");

    if (count >= 1_000_000) {
        return `${trim(count / 1_000_000)}M`;
    }

    if (count >= 100_000) {
        return `${String(Math.round(count / 1000))}k`;
    }

    return count >= 1000 ? `${trim(count / 1000)}k` : String(count);
}

function money(cost: number): string {
    return cost === 0 ? "$0" : `$${cost.toFixed(3)}`;
}

/**
 * What this conversation used, under the composer. One line that wraps out of sight: what does not
 * fit is hidden whole, never cut, and the first in line (the context) is the last to go.
 */
export function SessionMeta({
    session,
    sessions,
    status,
    usage,
    openSession,
}: {
    session: StatusProps["session"];
    sessions: SessionSummary[];
    status: ClientStatus[];
    usage: ClientUsage;
    openSession: (id: number) => void;
}) {
    return (
        <div className="text-meta -mt-1 flex h-6 shrink-0 flex-wrap items-center justify-center gap-x-3 overflow-hidden px-1 [&>*]:h-6">
            <StatusItems
                slot="composer"
                session={session}
                sessions={sessions}
                openSession={openSession}
            />
            {status
                .filter((field) => field.slot === "composer")
                .map((field) => (
                    <StatusField key={field.source} field={field} />
                ))}
            <span
                title={`${String(usage.input)} tokens in, ${String(usage.output)} out`}
                className="text-faint flex shrink-0 items-center font-mono"
            >
                ↑{compact(usage.input)} ↓{compact(usage.output)} · {money(usage.cost)}
            </span>
        </div>
    );
}
