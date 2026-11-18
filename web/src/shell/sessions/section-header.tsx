import { useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { MAX_FOLDER_NAME } from "../../../../shared/folders.ts";
import type { SessionSummary } from "../../../../shared/protocol.ts";
import { StateMark } from "../session-parts.tsx";
import { MENU_TRIGGER } from "./folder-actions.tsx";

/**
 * The heading of a section: pressing it folds every folder under it. A folder dropped on it goes under it, so it
 * is a drop target; it is not dragged itself, because it would leave its folders behind. Its menu moves it.
 */
export function SectionHeader({
    id,
    name,
    folders,
    folded,
    marked,
    renaming,
    canMoveUp,
    canMoveDown,
    onToggle,
    onRenameStart,
    onRename,
    onMove,
    onRemove,
}: {
    id: string;
    name: string;
    /** How many folders are under it. */
    folders: number;
    folded: boolean;
    /** A working or unseen session under it, shown while it is folded. */
    marked: SessionSummary | undefined;
    renaming: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onToggle: (id: string) => void;
    onRenameStart: (id: string) => void;
    /** Null leaves the name as it was. */
    onRename: (id: string, name: string | null) => void;
    onMove: (id: string, by: -1 | 1) => void;
    onRemove: (id: string) => void;
}) {
    const field = useRef<HTMLInputElement>(null);
    // Escape and Enter both leave the field, which then blurs: only the first of them decides.
    const done = useRef(false);
    // The field takes the caret only once the menu is gone: a menu still fading takes the keyboard back.
    const renameWhenClosed = useRef(false);
    const { setNodeRef, transform, transition } = useSortable({
        id,
        disabled: { draggable: true },
    });

    useEffect(() => {
        if (renaming) {
            done.current = false;
            field.current?.focus();
            field.current?.select();
        }
    }, [renaming]);

    const finish = (value: string | null): void => {
        if (!done.current) {
            done.current = true;
            onRename(id, value);
        }
    };

    return (
        <div
            ref={setNodeRef}
            style={{
                transform:
                    transform === null ? undefined : `translate3d(0, ${String(transform.y)}px, 0)`,
                transition,
            }}
            className="border-edge-soft mt-2 border-t pt-1 lg:group-data-[collapsed]/side:hidden"
        >
            <div className="group/folder hover:bg-raised/50 flex items-center gap-1 pr-1 pl-1.5 select-none">
                {renaming ? (
                    <Input
                        ref={field}
                        maxLength={MAX_FOLDER_NAME}
                        defaultValue={name}
                        aria-label="Section name"
                        onBlur={(event) => {
                            finish(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                finish(event.currentTarget.value);
                            } else if (event.key === "Escape") {
                                event.stopPropagation();
                                finish(null);
                            }
                        }}
                        className="border-edge-soft bg-canvas text-meta my-0.5 h-7 flex-1"
                    />
                ) : (
                    <button
                        type="button"
                        aria-expanded={!folded}
                        onClick={() => {
                            onToggle(id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                    >
                        <ChevronRight
                            className={cn(
                                "text-faint size-3 shrink-0 transition-transform motion-reduce:transition-none",
                                !folded && "rotate-90",
                            )}
                        />
                        <span className="text-meta text-muted min-w-0 truncate font-medium tracking-wide uppercase">
                            {name}
                        </span>
                        <span className="text-meta text-faint shrink-0">{folders}</span>
                        {folded && marked !== undefined ? <StateMark session={marked} /> : null}
                    </button>
                )}
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for section ${name}`}
                            className={MENU_TRIGGER}
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(event) => {
                            if (renameWhenClosed.current) {
                                event.preventDefault();
                                renameWhenClosed.current = false;
                                onRenameStart(id);
                            }
                        }}
                    >
                        <DropdownMenuItem
                            onSelect={() => {
                                renameWhenClosed.current = true;
                            }}
                        >
                            <Pencil className="size-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={!canMoveUp}
                            onSelect={() => {
                                onMove(id, -1);
                            }}
                        >
                            <ArrowUp className="size-4" />
                            Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!canMoveDown}
                            onSelect={() => {
                                onMove(id, 1);
                            }}
                        >
                            <ArrowDown className="size-4" />
                            Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                onRemove(id);
                            }}
                        >
                            <Trash2 className="size-4" />
                            Remove section
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {folders === 0 && !folded ? (
                <Empty className="px-2 py-1.5">Drag a folder here</Empty>
            ) : null}
        </div>
    );
}
