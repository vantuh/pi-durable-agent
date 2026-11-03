import { memo } from "react";

import { Progress } from "@/components/ui/progress";
import { Hint } from "@/components/ui/tooltip";

import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";
import { useStatusItems } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "./item-boundary.tsx";

/**
 * The `web.tsx` items of one place, each in its own boundary. A streamed frame rebuilds every ancestor of this, and
 * what it draws changes only when the session it is handed does.
 */
export const StatusItems = memo(function StatusItems({
    slot,
    session,
    sessions,
    openSession,
}: {
    slot: ClientStatus["slot"];
    session: StatusProps["session"];
    sessions: SessionSummary[];
    openSession: (id: number) => void;
}) {
    const statusItems = useStatusItems();

    return (
        statusItems
            .filter((item) => item.slot === slot)
            // Lower first, and `filter` kept the folders' order for equals: the sort is stable.
            .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
            .map(({ folder, id, component: Item }) => (
                <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                    <Item session={session} sessions={sessions} openSession={openSession} />
                </ItemBoundary>
            ))
    );
});

/** One field a server half sent. Below `sm` an `end` field is hidden, and a `center` one loses its label. */
export function StatusField({ field }: { field: ClientStatus }) {
    const readout = (
        <span
            className={`text-faint shrink-0 items-center gap-1.5 font-mono ${field.slot === "end" ? "hidden sm:flex" : "flex"}`}
        >
            {field.label === undefined ? null : (
                <span className={field.slot === "center" ? "hidden sm:inline" : ""}>
                    {field.label}
                </span>
            )}
            {field.meter === undefined ? null : (
                <Progress
                    value={Math.round(field.meter.fill * 100)}
                    tone={field.meter.tone ?? "accent"}
                    className="w-9"
                    aria-label={field.label ?? field.source}
                />
            )}
            {field.text}
        </span>
    );

    // A readout is not a control: a tab stop here would put every field of the bar in the tab order,
    // so the hint stays on hover, which is still more than `title` gave.
    return field.title === undefined ? readout : <Hint label={field.title}>{readout}</Hint>;
}
