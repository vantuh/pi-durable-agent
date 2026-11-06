import { Settings } from "lucide-react";
import { memo, type RefObject } from "react";

import { Button, REACH } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

import type { ClientStatus, SessionSummary } from "../../../shared/protocol.ts";
import type { StatusProps } from "../sdk/types.ts";
import { StatusField, StatusItems } from "../ui/status-fields.tsx";
import { SessionsStatus } from "./sessions-status/sessions-status.tsx";

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
    settingsOpen: boolean;
    settingsGear: RefObject<HTMLButtonElement | null>;
    onSettings: () => void;
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
export const StatusBar = memo(function StatusBar({
    connected,
    session,
    status,
    busy,
    issue,
    sessions,
    current,
    onOpen,
    settingsOpen,
    settingsGear,
    onSettings,
}: Props) {
    const tone = issue === null ? (busy ? "warn" : connected ? "ok" : "danger") : "danger";
    const label = issue ?? (busy ? "working" : connected ? "ready" : "offline");
    const at = (slot: ClientStatus["slot"]) => status.filter((field) => field.slot === slot);

    return (
        <footer
            className={`border-edge-soft bg-panel text-meta text-muted grid h-7 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 overflow-hidden border-t px-3 pointer-coarse:h-11`}
        >
            <div className="flex min-w-0 items-center gap-3">
                <SessionsStatus sessions={sessions} current={current} onOpen={onOpen}>
                    <span className={`size-2 ${toneOf(tone)}`} />
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
                {/* A phone keeps the state and the settings: five chips around a 171px cell drew over the state. */}
                <div className="hidden min-w-0 items-center gap-3 sm:flex">
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
                <Hint label="Settings">
                    <Button
                        ref={settingsGear}
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Settings"
                        aria-pressed={settingsOpen}
                        onClick={onSettings}
                        className={`shrink-0 ${REACH} ${settingsOpen ? "bg-raised text-ink" : ""}`}
                    >
                        <Settings className="size-4" />
                    </Button>
                </Hint>
            </div>
        </footer>
    );
});
