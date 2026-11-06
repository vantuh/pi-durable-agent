import { House } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Empty } from "@/components/ui/empty";
import { Hint } from "@/components/ui/tooltip";
import { useStatusRowItems } from "@/extensions.ts";
import { holdingRow } from "@/lib/session-nesting.ts";
import { statusRows } from "@/lib/status-rows.ts";
import { CountSuffix } from "@/ui/count-suffix.tsx";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { Row } from "./row.tsx";

type Props = {
    sessions: SessionSummary[];
    current: number | null;
    onOpen: (id: number | null) => void;
    /** The state of the open session, drawn first in the trigger. */
    children: ReactNode;
};

/** The rows; their clock is read when the menu opens, so the times hold still while it is read. */
function Rows({
    active,
    activeIsOpen,
    others,
    sessions,
    onOpen,
    onClose,
}: {
    active: SessionSummary | undefined;
    activeIsOpen: boolean;
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
    const rowProps = { sessions, now, openSession, onClose };

    return (
        <>
            {active === undefined ? null : (
                <Row session={active} isOpen={activeIsOpen} {...rowProps} />
            )}
            {others.map((session) => (
                <Row key={session.id} session={session} isOpen={false} {...rowProps} />
            ))}
        </>
    );
}

/** The app's state, then how many other sessions work or wait unseen; a click lists them. */
export function SessionsStatus({ sessions, current, onOpen, children }: Props) {
    const [open, setOpen] = useState(false);
    const markers = useStatusRowItems();
    // A nested session has no row of its own: the row that holds it stands in for it.
    const holder = holdingRow(current, sessions);
    const { working, marked, unseen } = statusRows(sessions, holder ?? current, (session) =>
        markers.some((marker) => marker.has(session, sessions)),
    );
    const openRow = sessions.find((session) => session.id === (holder ?? current));
    // The open session is listed only while it is at work, like the others.
    const active =
        openRow !== undefined &&
        (openRow.busy || markers.some((marker) => marker.has(openRow, sessions)))
            ? openRow
            : undefined;

    return (
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
            <Hint label="Sessions at work">
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="hover:bg-sunken aria-expanded:bg-sunken -mx-1.5 shrink-0 px-1.5 py-0.5"
                    >
                        {children}
                        {working.length === 0 ? null : (
                            <span className="text-accent">
                                · {working.length}
                                <CountSuffix>{" working"}</CountSuffix>
                            </span>
                        )}
                        {unseen.length === 0 ? null : (
                            <span className="text-ok">
                                · {unseen.length}
                                <CountSuffix>{" new"}</CountSuffix>
                            </span>
                        )}
                    </Button>
                </DropdownMenuTrigger>
            </Hint>
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
                    activeIsOpen={holder === null}
                    others={[...working, ...marked, ...unseen]}
                    sessions={sessions}
                    onOpen={onOpen}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
                {active === undefined && working.length + marked.length + unseen.length === 0 ? (
                    <Empty className="px-2 py-1.5">No session is working</Empty>
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
