import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { memo, type ReactNode, useCallback, useRef } from "react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuTrigger,
    DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import type { FolderSessionMenuItem } from "@/extensions.ts";
import { segments } from "@/lib/fuzzy.ts";
import { isPlainClick, sessionHref } from "@/lib/route.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { SessionMarks, StateMark } from "../session-parts.tsx";
import { labelOf, runKey } from "./menu-item.ts";
import { FADE } from "./rail.ts";
import { RenameForm } from "./rename-form.tsx";

function iconOf(
    part: ReactNode | ((session: SessionSummary) => ReactNode),
    session: SessionSummary,
): ReactNode {
    return typeof part === "function" ? part(session) : part;
}

type RowProps = {
    session: SessionSummary;
    /** Sessions started from this one that are working, shown as its mark. */
    working: number;
    /** Null when the session has no activity time yet. */
    time: string | null;
    ranges: [number, number][];
    current: boolean;
    holding: boolean;
    menu: readonly FolderSessionMenuItem[];
    running: ReadonlySet<string>;
    pending: boolean;
    /** This row is the one being renamed. */
    renaming: boolean;
    registerRow: (id: number, node: HTMLDivElement | null) => void;
    onOpen: (id: number) => void;
    onRunItem: (item: FolderSessionMenuItem, session: SessionSummary) => void;
    onRename: (session: SessionSummary) => void;
    onRenameSave: (id: number, name: string) => Promise<void>;
    onRenameCancel: () => void;
    onArchive: (id: number, archived: boolean) => Promise<void>;
    /** The menu's Delete was chosen: ask before doing it. */
    onDelete: (session: SessionSummary) => void;
    /** This row is the one being asked about. */
    deleting: boolean;
    onConfirmDelete: (id: number) => Promise<void>;
    onCancelDelete: () => void;
};

// Every prop is a primitive, a row object that keeps its identity until the row changes, or a callback
// that Sessions keeps stable: a session-list event then re-renders only the rows it touched.
export const SessionRow = memo(function SessionRow({
    session,
    working,
    time,
    ranges,
    current,
    holding,
    menu,
    running,
    pending,
    renaming,
    registerRow,
    onOpen,
    onRunItem,
    onRename,
    onRenameSave,
    onRenameCancel,
    onArchive,
    onDelete,
    deleting,
    onConfirmDelete,
    onCancelDelete,
}: RowProps) {
    const attach = useCallback(
        (node: HTMLDivElement | null) => {
            registerRow(session.id, node);
        },
        [registerRow, session.id],
    );
    const actions = useRef<HTMLButtonElement>(null);
    // The menu hands the form over only once it is gone: opening it on the select leaves the field without the
    // caret, because a menu still fading takes the keyboard back a moment after the form asks for it.
    const renameWhenClosed = useRef(false);

    return (
        <>
            <Popover
                open={renaming}
                onOpenChange={(next) => {
                    if (!next) {
                        onRenameCancel();
                    }
                }}
            >
                <PopoverAnchor asChild>
                    <div
                        ref={attach}
                        data-holds-open={holding ? "" : undefined}
                        className={`session-row group relative flex items-center ${current || holding ? "bg-raised" : "hover:bg-raised/50"}`}
                    >
                        <Item asChild className="min-w-0 flex-1">
                            <a
                                href={sessionHref(session.id)}
                                onClick={(event) => {
                                    if (!isPlainClick(event)) {
                                        return;
                                    }

                                    event.preventDefault();
                                    onOpen(session.id);
                                }}
                                aria-current={current ? "page" : holding ? "true" : undefined}
                                className="text-left"
                            >
                                <StateMark session={session} working={working} />
                                <ItemTitle className={`min-w-0 flex-1 ${FADE}`}>
                                    {segments(session.title ?? "New session", ranges).map(
                                        (part, index) => (
                                            <span
                                                key={`${String(index)}-${part.text}`}
                                                className={
                                                    part.hit ? "bg-warn/30 text-ink" : undefined
                                                }
                                            >
                                                {part.text}
                                            </span>
                                        ),
                                    )}
                                </ItemTitle>
                                <SessionMarks session={session} />
                                <span
                                    className={`session-time text-faint text-meta min-w-7 shrink-0 text-right ${FADE}`}
                                >
                                    {time}
                                </span>
                            </a>
                        </Item>
                        <DropdownMenu modal={false}>
                            <Hint label="Session actions">
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        ref={actions}
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Actions for ${session.title ?? "New session"}`}
                                        className="session-actions hover:bg-panel absolute right-1 lg:group-data-[collapsed]/side:hidden"
                                    >
                                        <MoreHorizontal className="size-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                            </Hint>
                            <DropdownMenuContent
                                align="end"
                                onCloseAutoFocus={(event) => {
                                    event.preventDefault();

                                    if (!renameWhenClosed.current) {
                                        return;
                                    }

                                    renameWhenClosed.current = false;
                                    onRename(session);
                                }}
                            >
                                {menu.map((item) => {
                                    const { submenu: Submenu } = item;

                                    if (Submenu === undefined) {
                                        return (
                                            <DropdownMenuItem
                                                key={item.id}
                                                disabled={running.has(runKey(item, session))}
                                                onSelect={() => {
                                                    onRunItem(item, session);
                                                }}
                                            >
                                                {iconOf(item.icon, session)}
                                                {labelOf(item, session)}
                                            </DropdownMenuItem>
                                        );
                                    }

                                    return (
                                        <DropdownMenuSub key={item.id}>
                                            <DropdownMenuSubTrigger>
                                                {iconOf(item.icon, session)}
                                                {labelOf(item, session)}
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                                <Submenu session={session} />
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                    );
                                })}
                                {menu.length === 0 ? null : <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                    onSelect={() => {
                                        renameWhenClosed.current = true;
                                    }}
                                >
                                    <Pencil />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={pending}
                                    onSelect={() => {
                                        void onArchive(session.id, !session.archived);
                                    }}
                                >
                                    {session.archived ? <ArchiveRestore /> : <Archive />}
                                    {session.archived ? "Restore" : "Archive"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={() => {
                                        onDelete(session);
                                    }}
                                >
                                    <Trash2 />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    side="bottom"
                    align="start"
                    aria-label="Rename session"
                    className="text-meta w-64 p-2"
                    onCloseAutoFocus={(event) => {
                        // The menu item that opened it is gone with its menu: the row's own trigger takes focus back.
                        event.preventDefault();
                        actions.current?.focus();
                    }}
                >
                    <RenameForm
                        id={session.id}
                        name={session.name ?? ""}
                        pending={pending}
                        onSave={onRenameSave}
                        onCancel={onRenameCancel}
                    />
                </PopoverContent>
            </Popover>

            <AlertDialog
                open={deleting}
                onOpenChange={(open) => {
                    // Escape and Cancel answer nothing while the answer is being carried out.
                    if (!open && !pending) {
                        onCancelDelete();
                    }
                }}
            >
                <AlertDialogContent
                    onCloseAutoFocus={(event) => {
                        // The menu item that opened it went with its menu: the row's trigger takes focus back.
                        event.preventDefault();
                        actions.current?.focus();
                    }}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete “{session.title ?? "New session"}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>It disappears for good.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>No</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={pending}
                            onClick={(event) => {
                                event.preventDefault();
                                void onConfirmDelete(session.id);
                            }}
                        >
                            {pending ? "Deleting…" : "Yes, delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
});
