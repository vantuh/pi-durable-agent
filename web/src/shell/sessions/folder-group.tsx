import { useSortable } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, ChevronUp, Folder } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FOLDER_PAGE, LOOSE } from "@/lib/session-folders.ts";
import { cn } from "@/lib/utils";

import { MAX_FOLDER_NAME, type FolderColor, type FolderLook } from "../../../../shared/folders.ts";
import type { SessionSummary } from "../../../../shared/protocol.ts";
import { folderName, StateMark } from "../session-parts.tsx";
import { FolderActions } from "./folder-actions.tsx";
import { FOLDER_TEXT } from "./folder-tones.ts";

/** Its content grows from nothing and shrinks back; `inert` keeps what is hidden out of the tab order. */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
    return (
        <div
            inert={!open}
            // 0fr to 1fr is how a height animates to its natural size: the value is this drawing's own.
            className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
                open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
        >
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    );
}

/**
 * One folder of the sidebar: a header that folds it and that a finger or a mouse drags to reorder, then its sessions
 * five at a time. Every page stays mounted and closed, so "more" can open it with the same motion as the fold.
 */
export function FolderGroup({
    cwd,
    name,
    color,
    sessions,
    open,
    folded,
    searching,
    canMoveUp,
    canMoveDown,
    onToggle,
    onNew,
    onOpenCount,
    onLook,
    onMove,
    renderRow,
}: {
    cwd: string;
    /** What the header says: the name set by hand, else the folder's own. */
    name: string;
    color: FolderColor | undefined;
    sessions: SessionSummary[];
    /** How many sessions are open (`openCount`). */
    open: number;
    folded: boolean;
    searching: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onToggle: (cwd: string) => void;
    /** A new session in this folder, opened at once. */
    onNew: (cwd: string) => void;
    onOpenCount: (cwd: string, count: number) => void;
    onLook: (cwd: string, look: FolderLook) => void;
    onMove: (cwd: string, by: -1 | 1) => void;
    renderRow: (session: SessionSummary) => ReactNode;
}) {
    const [renaming, setRenaming] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    // Escape and Enter both leave the field, which then blurs: only the first of them decides.
    const done = useRef(false);
    const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
        useSortable({ id: cwd, disabled: renaming || cwd === LOOSE });

    useEffect(() => {
        if (renaming) {
            done.current = false;
            field.current?.focus();
            field.current?.select();
        }
    }, [renaming]);

    const finish = (value: string | null): void => {
        if (done.current) {
            return;
        }

        done.current = true;
        setRenaming(false);

        if (value !== null) {
            const next = value.trim();

            onLook(cwd, { name: next === "" || next === folderName(cwd) ? undefined : next });
        }
    };
    // A page is a slot, not its sessions: a new session shifts them between pages, and a page must not remount.
    const pages = Array.from({ length: Math.ceil(sessions.length / FOLDER_PAGE) }, (_, slot) => ({
        slot,
        rows: sessions.slice(slot * FOLDER_PAGE, (slot + 1) * FOLDER_PAGE),
    }));
    const marked =
        sessions.find((session) => session.busy) ?? sessions.find((session) => session.unseen);

    return (
        <section
            ref={setNodeRef}
            style={{
                transform:
                    transform === null ? undefined : `translate3d(0, ${String(transform.y)}px, 0)`,
                transition,
            }}
            className={cn(isDragging && "bg-panel shadow-float relative z-10")}
        >
            <div
                ref={setActivatorNodeRef}
                {...listeners}
                className="group/folder hover:bg-raised/50 flex items-center gap-1 pr-1 pl-1.5 select-none lg:group-data-[collapsed]/side:hidden"
            >
                {renaming ? (
                    <Input
                        ref={field}
                        maxLength={MAX_FOLDER_NAME}
                        defaultValue={name}
                        aria-label="Folder name"
                        placeholder={folderName(cwd)}
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
                        className="border-edge-soft bg-canvas text-meta my-0.5 h-7 flex-1 font-mono"
                    />
                ) : (
                    <button
                        type="button"
                        aria-expanded={!folded}
                        title={cwd}
                        onClick={() => {
                            onToggle(cwd);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                    >
                        <ChevronRight
                            className={cn(
                                "text-faint size-3 shrink-0 transition-transform motion-reduce:transition-none",
                                !folded && "rotate-90",
                            )}
                        />
                        <Folder
                            className={cn(
                                "size-4 shrink-0",
                                color === undefined ? "text-faint" : FOLDER_TEXT[color],
                            )}
                        />
                        <span className="text-meta text-ink min-w-0 truncate font-mono">
                            {name}
                        </span>
                        <span className="text-meta text-faint shrink-0">{sessions.length}</span>
                        {folded && marked !== undefined ? <StateMark session={marked} /> : null}
                    </button>
                )}
                {cwd === LOOSE ? null : (
                    <FolderActions
                        name={name}
                        color={color}
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        onNew={() => {
                            onNew(cwd);
                        }}
                        onRename={() => {
                            setRenaming(true);
                        }}
                        onColor={(next) => {
                            onLook(cwd, { color: next });
                        }}
                        onMove={(by) => {
                            onMove(cwd, by);
                        }}
                    />
                )}
            </div>
            <Reveal open={!folded}>
                {/* Indented under the header, so a row reads as part of its folder; the rail has no room for it. */}
                <div className="ml-3 lg:group-data-[collapsed]/side:ml-0">
                    {pages.map((page) => (
                        <Reveal
                            key={page.slot}
                            open={page.slot === 0 || open > page.slot * FOLDER_PAGE}
                        >
                            {page.rows.map(renderRow)}
                        </Reveal>
                    ))}
                </div>
                {searching || sessions.length <= FOLDER_PAGE ? null : (
                    <div className="ml-3 flex items-center gap-1 py-0.5 lg:group-data-[collapsed]/side:hidden">
                        {open < sessions.length ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                    onOpenCount(cwd, open + FOLDER_PAGE);
                                }}
                            >
                                <ChevronDown className="size-3" />
                                {Math.min(FOLDER_PAGE, sessions.length - open)} more
                            </Button>
                        ) : null}
                        {open > FOLDER_PAGE ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex-1"
                                onClick={() => {
                                    onOpenCount(cwd, FOLDER_PAGE);
                                }}
                            >
                                <ChevronUp className="size-3" />
                                Less
                            </Button>
                        ) : null}
                    </div>
                )}
            </Reveal>
        </section>
    );
}
