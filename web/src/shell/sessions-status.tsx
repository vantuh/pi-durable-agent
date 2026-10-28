import { House } from "lucide-react";
import { type ReactNode, useRef, useState, useSyncExternalStore } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { useStatusRowItems } from "../extensions.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { holdingRow } from "../lib/session-nesting.ts";
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
const NARROW = "(max-width: 639px)";

function watchNarrow(notify: () => void): () => void {
    const query = matchMedia(NARROW);

    query.addEventListener("change", notify);

    return () => {
        query.removeEventListener("change", notify);
    };
}

const isNarrow = (): boolean => matchMedia(NARROW).matches;

type RowProps = {
    session: SessionSummary;
    sessions: SessionSummary[];
    now: number;
    /** The open session: its row is not a link, and activating it only closes the popover. */
    isOpen: boolean;
    openSession: (id: number) => void;
    onClose: () => void;
};

/**
 * One row. Extensions put markers between its title and its time; if one of them also gives a
 * submenu, the whole row opens it. Radix opens a submenu on click, so the click and Enter are
 * taken over here: they still open the session.
 *
 * - Wide screens: the row is the submenu's Radix `SubTrigger`. Hovering opens it after Radix's
 *   short delay; ArrowRight or Space opens it from the keyboard. A touch has no hover, so its first
 *   tap opens the submenu and the second tap opens the session.
 * - Narrow screens: Radix puts a submenu beside its row, and a phone has no room beside a row, so
 *   the submenu opens below it, inside the popover. The first click or tap opens it and the second
 *   opens the session.
 */
function Row({ session, sessions, now, isOpen, openSession, onClose }: RowProps) {
    const items = useStatusRowItems().filter((item) => item.has(session, sessions));
    const submenu = items.find((item) => item.submenu !== undefined)?.submenu;
    const [subOpen, setSubOpen] = useState(false);
    const pointer = useRef("mouse");
    const narrow = useSyncExternalStore(watchNarrow, isNarrow);
    const activate = (): void => {
        if (isOpen) {
            onClose();
        } else {
            openSession(session.id);
        }
    };
    const content = (
        <SessionRowContent
            session={session}
            now={now}
            trailing={items.map(({ folder, id, component: Marker }) => (
                <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                    <Marker session={session} sessions={sessions} openSession={openSession} />
                </ItemBoundary>
            ))}
        />
    );
    const look = isOpen
        ? `bg-raised data-[highlighted]:bg-raised ${ROW}`
        : `data-[highlighted]:bg-raised/50 ${ROW}`;
    const link = (
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
            {content}
        </a>
    );
    // Under a submenu the trigger's own click handler decides, so the anchor has none.
    const triggerLink = <a href={sessionHref(session.id)}>{content}</a>;

    if (submenu === undefined) {
        return isOpen ? (
            <DropdownMenuItem className={look}>{content}</DropdownMenuItem>
        ) : (
            <DropdownMenuItem asChild className={look}>
                {link}
            </DropdownMenuItem>
        );
    }

    const Submenu = submenu;
    const body = (
        <ItemBoundary name="status row submenu">
            <Submenu session={session} sessions={sessions} openSession={openSession} />
        </ItemBoundary>
    );

    if (narrow) {
        return (
            <>
                <DropdownMenuItem
                    asChild={!isOpen}
                    className={look}
                    aria-expanded={subOpen}
                    onClick={(event) => {
                        if (!isPlainClick(event)) {
                            return;
                        }

                        event.preventDefault();

                        if (subOpen) {
                            activate();
                        } else {
                            setSubOpen(true);
                        }
                    }}
                >
                    {isOpen ? content : triggerLink}
                </DropdownMenuItem>
                {subOpen ? (
                    <div className="border-edge-soft ml-3 border-l pl-1">
                        <ScrollArea viewportProps={{ className: "max-h-[min(220px,45vh)]" }}>
                            {body}
                        </ScrollArea>
                    </div>
                ) : null}
            </>
        );
    }

    return (
        <DropdownMenuSub open={subOpen} onOpenChange={setSubOpen}>
            <DropdownMenuSubTrigger
                asChild={!isOpen}
                className={`w-full ${look}`}
                onPointerDown={(event) => {
                    pointer.current = event.pointerType;
                }}
                onClick={(event) => {
                    if (!isPlainClick(event)) {
                        return;
                    }

                    // Without preventDefault Radix opens the submenu instead of the session.
                    event.preventDefault();

                    if (pointer.current !== "mouse" && !subOpen) {
                        setSubOpen(true);
                    } else {
                        activate();
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && event.target === event.currentTarget) {
                        event.preventDefault();
                        activate();
                    }
                }}
            >
                {isOpen ? content : triggerLink}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-52">
                <ScrollArea viewportProps={{ className: "max-h-[min(220px,45vh)]" }}>
                    {body}
                </ScrollArea>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

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
    const active = sessions.find((session) => session.id === (holder ?? current));

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
                    activeIsOpen={holder === null}
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
