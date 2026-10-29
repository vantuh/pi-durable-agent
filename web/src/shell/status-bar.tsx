import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";
import type { StatusProps } from "../sdk/types.ts";
import { StatusField, StatusItems } from "../ui/status-fields.tsx";
import { SessionsStatus } from "./sessions-status.tsx";

type Props = {
    connected: boolean;
    session: StatusProps["session"];
    status: ClientStatus[];
    busy: boolean;
    issue: string | null;
    sessions: SessionSummary[];
    /** Null on the home page. */
    current: number | null;
    onOpen: (id: number | null) => void;
};

function toneOf(status: "ok" | "warn" | "danger"): string {
    if (status === "danger") {
        return "bg-danger";
    }

    if (status === "warn") {
        return "bg-warn";
    }

    return "bg-ok";
}

/** The state of the app, not of one conversation: that is shown by the composer and the header. */
export function StatusBar({
    connected,
    session,
    status,
    busy,
    issue,
    sessions,
    current,
    onOpen,
}: Props) {
    const tone = issue === null ? (busy ? "warn" : connected ? "ok" : "danger") : "danger";
    const label = issue ?? (busy ? "working" : connected ? "ready" : "offline");
    const at = (slot: ClientStatus["slot"]) => status.filter((field) => field.slot === slot);

    return (
        <footer className="rounded-card border-edge-soft bg-canvas text-meta text-muted grid h-8 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 overflow-hidden border px-3">
            <div className="flex min-w-0 items-center gap-3">
                <SessionsStatus sessions={sessions} current={current} onOpen={onOpen}>
                    <span className={`size-2 rounded-full ${toneOf(tone)}`} />
                    <span className={tone === "danger" ? "text-danger" : "text-ink"}>{label}</span>
                </SessionsStatus>

                <StatusItems
                    slot="start"
                    session={session}
                    sessions={sessions}
                    openSession={onOpen}
                />
                {at("start").map((field) => (
                    <StatusField key={field.source} field={field} />
                ))}
            </div>

            <div className="flex items-center gap-3">
                <StatusItems
                    slot="center"
                    session={session}
                    sessions={sessions}
                    openSession={onOpen}
                />
                {at("center").map((field) => (
                    <StatusField key={field.source} field={field} />
                ))}
            </div>

            <div className="flex min-w-0 items-center justify-end gap-3">
                <StatusItems
                    slot="end"
                    session={session}
                    sessions={sessions}
                    openSession={onOpen}
                />
                {at("end").map((field) => (
                    <StatusField key={field.source} field={field} />
                ))}
            </div>
        </footer>
    );
}
