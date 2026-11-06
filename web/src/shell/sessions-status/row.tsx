import { useRef, useState, useSyncExternalStore } from "react";

import {
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { useStatusRowItems } from "@/extensions.ts";
import { isNarrow, watchNarrow } from "@/lib/narrow.ts";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import { ItemBoundary } from "@/ui/item-boundary.tsx";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { SessionRowContent } from "../session-parts.tsx";

/** The padding only: the gap, the hover fill and the open look are the menu item's, which is the row. */
const ROW = "px-2 py-1.5";

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
export function Row({ session, sessions, now, isOpen, openSession, onClose }: RowProps) {
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
