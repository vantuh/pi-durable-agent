import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";
import { useStatusItems } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "./item-boundary.tsx";

/** The `web.tsx` items of one place, each in its own boundary. */
export function StatusItems({
    slot,
    session,
    sessions,
}: {
    slot: ClientStatus["slot"];
    session: StatusProps["session"];
    sessions: SessionSummary[];
}) {
    const statusItems = useStatusItems();

    return statusItems
        .filter((item) => item.slot === slot)
        .map(({ folder, id, component: Item }) => (
            <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                <Item session={session} sessions={sessions} />
            </ItemBoundary>
        ));
}

const FILL_TONE = { warn: "bg-warn", danger: "bg-danger" };

/** One field a server half sent. Below `sm` an `end` field is hidden, and a `center` one loses its label. */
export function StatusField({ field }: { field: ClientStatus }) {
    return (
        <span
            title={field.title}
            className={`text-faint shrink-0 items-center gap-1.5 font-mono ${field.slot === "end" ? "hidden sm:flex" : "flex"}`}
        >
            {field.label === undefined ? null : (
                <span className={field.slot === "center" ? "hidden sm:inline" : ""}>
                    {field.label}
                </span>
            )}
            {field.meter === undefined ? null : (
                <span className="bg-raised flex h-1 w-9 overflow-hidden rounded-full">
                    <span
                        className={
                            field.meter.tone === undefined
                                ? "bg-accent"
                                : FILL_TONE[field.meter.tone]
                        }
                        style={{ width: `${String(Math.round(field.meter.fill * 100))}%` }}
                    />
                </span>
            )}
            {field.text}
        </span>
    );
}
