import { House } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { useStatusRowItems } from "../extensions.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { statusRows } from "../lib/status-rows.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";
import { SessionRowContent } from "./session-parts.tsx";

type Props = {
    sessions: SessionSummary[];
    current: number | null;
    onOpen: (id: number | null) => void;
    /** The state of the open session, drawn first in the trigger. */
    children: ReactNode;
};

const ROW = "gap-3 px-2 py-1.5";

/** The markers extensions put at the end of one row; the row's link keeps the rest of its width. */
function RowMarkers({
    session,
    sessions,
    openSession,
}: {
    session: SessionSummary;
    sessions: SessionSummary[];
    openSession: (id: number) => void;
}) {
    return useStatusRowItems()
        .filter((item) => item.has(session, sessions))
        .map(({ folder, id, component: Marker }) => (
            <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                <Marker session={session} sessions={sessions} openSession={openSession} />
            </ItemBoundary>
        ));
}

/** The rows; their clock is read when the menu opens, so the times hold still while it is read. */
function Rows({
    active,
    others,
    sessions,
    onOpen,
    onClose,
}: {
    active: SessionSummary | undefined;
    others: SessionSummary[];
    sessions: SessionSummary[];
    onOpen: (id: number) => void;
    onClose: () => void;
}) {
    const [now] = useState(() => Date.now());
    const openSession = (id: number): void => {
        onClose();
        onOpen(id);
    };

    return (
        <>
            {active === undefined ? null : (
                <div className="flex items-center">
                    <DropdownMenuItem className={`bg-raised data-[highlighted]:bg-raised ${ROW}`}>
                        <SessionRowContent session={active} now={now} />
                    </DropdownMenuItem>
                    <RowMarkers session={active} sessions={sessions} openSession={openSession} />
                </div>
            )}
            {others.map((session) => (
                <div key={session.id} className="flex items-center">
                    <DropdownMenuItem
                        asChild
                        className={`data-[highlighted]:bg-raised/50 min-w-0 flex-1 ${ROW}`}
                    >
                        <a
                            href={sessionHref(session.id)}
                            onClick={(event) => {
                                // A modified click is the browser's: a new tab, and the menu stays.
                                if (isPlainClick(event)) {
                                    event.preventDefault();
                                    openSession(session.id);
                                }
                            }}
                        >
                            <SessionRowContent session={session} now={now} />
                        </a>
                    </DropdownMenuItem>
                    <RowMarkers session={session} sessions={sessions} openSession={openSession} />
                </div>
            ))}
        </>
    );
}

/** The app's state, then how many other sessions work or wait unseen; a click lists them. */
export function SessionsStatus({ sessions, current, onOpen, children }: Props) {
    const [open, setOpen] = useState(false);
    const markers = useStatusRowItems();
    const { working, marked, unseen } = statusRows(sessions, current, (session) =>
        markers.some((marker) => marker.has(session, sessions)),
    );
    const active = sessions.find((session) => session.id === current);

    return (
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    title="Sessions at work"
                    className="rounded-control hover:bg-sunken aria-expanded:bg-sunken -mx-1.5 flex shrink-0 items-center gap-1.5 px-1.5 py-0.5"
                >
                    {children}
                    {working.length === 0 ? null : (
                        <span className="text-accent">· {working.length} working</span>
                    )}
                    {unseen.length === 0 ? null : (
                        <span className="text-ok">· {unseen.length} new</span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="top"
                align="start"
                className="w-80 max-w-[calc(100vw-1rem)]"
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                }}
            >
                <Rows
                    active={active}
                    others={[...working, ...marked, ...unseen]}
                    sessions={sessions}
                    onOpen={onOpen}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
                {working.length + marked.length + unseen.length === 0 ? (
                    <p className="text-meta text-faint px-2 py-1.5">
                        {active === undefined
                            ? "No session is working"
                            : "No other session is working"}
                    </p>
                ) : null}
                <DropdownMenuItem
                    className="text-muted mt-1 gap-2 px-2 py-1.5"
                    onSelect={() => {
                        onOpen(null);
                    }}
                >
                    <House />
                    All sessions
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
