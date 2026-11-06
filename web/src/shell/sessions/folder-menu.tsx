import { ChevronDown, ChevronRight, Folder, GitFork } from "lucide-react";
import {
    Fragment,
    type ReactNode,
    type RefObject,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isNarrow, watchNarrow } from "@/lib/narrow.ts";
import { isPlainClick } from "@/lib/route.ts";
import type { FolderRow } from "@/lib/session-folders.ts";

import { folderName } from "../session-parts.tsx";

export function FolderMenu({
    scopeOpen,
    onScopeOpenChange,
    scope,
    all,
    folder,
    folders,
    count,
    chosen,
    onPick,
    onPickAll,
}: {
    scopeOpen: boolean;
    onScopeOpenChange: (open: boolean) => void;
    /** What the trigger says: "All", or the folder. */
    scope: string;
    all: boolean;
    folder: string | null;
    folders: FolderRow[];
    /** How many sessions "All" holds. */
    count: number;
    /** The row of the folder in use, which takes the focus when the menu opens from the keyboard. */
    chosen: RefObject<HTMLDivElement | null>;
    onPick: (cwd: string) => void;
    onPickAll: () => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const narrow = useSyncExternalStore(watchNarrow, isNarrow);
    // Which kind of pointer chose, so a phone's first tap can open the worktrees instead of choosing.
    const pointer = useRef("mouse");
    const holds = (row: FolderRow, cwd: string | null): boolean =>
        cwd !== null && (row.cwd === cwd || row.worktrees.some((child) => holds(child, cwd)));
    // A folder with worktrees opens them; the row itself chooses the folder, hover and → open the list.
    // A phone has no room beside a row, so there the worktrees come out under it instead.
    const folderRow = (row: FolderRow, nested: boolean): ReactNode => {
        const inside = !all && holds(row, folder);
        const name = (
            <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                {folderName(row.cwd)}
            </span>
        );
        const icon = nested ? (
            <GitFork className="text-faint shrink-0" />
        ) : (
            <Folder className="text-faint shrink-0" />
        );
        const look = inside ? "bg-raised" : "data-[highlighted]:bg-raised/50";
        const ref = !all && !nested && inside ? chosen : undefined;

        if (row.worktrees.length === 0) {
            return (
                <DropdownMenuItem
                    key={row.cwd}
                    title={row.cwd}
                    onSelect={() => {
                        onPick(row.cwd);
                    }}
                    ref={ref}
                    className={look}
                >
                    {icon}
                    {name}
                    <span className="text-faint text-meta">{row.count}</span>
                </DropdownMenuItem>
            );
        }

        if (narrow) {
            const open = expanded === row.cwd;

            return (
                <Fragment key={row.cwd}>
                    <DropdownMenuItem
                        title={row.cwd}
                        aria-expanded={open}
                        onSelect={(event) => {
                            // The first click brings the worktrees out; the second one chooses the folder.
                            if (open) {
                                onPick(row.cwd);

                                return;
                            }

                            event.preventDefault();
                            setExpanded(row.cwd);
                        }}
                        ref={ref}
                        className={look}
                    >
                        {icon}
                        {name}
                        <span className="text-faint text-meta">{row.count}</span>
                        <ChevronDown
                            className={`text-faint shrink-0 transition-transform ${
                                open ? "rotate-180" : ""
                            }`}
                        />
                    </DropdownMenuItem>
                    {open ? (
                        <div className="border-edge-soft ml-3 border-l pl-1">
                            {row.worktrees.map((worktree) => folderRow(worktree, true))}
                        </div>
                    ) : null}
                </Fragment>
            );
        }

        return (
            <DropdownMenuSub key={row.cwd}>
                <DropdownMenuSubTrigger
                    title={row.cwd}
                    ref={ref}
                    className={look}
                    onPointerDown={(event) => {
                        pointer.current = event.pointerType;
                    }}
                    onClick={(event) => {
                        if (!isPlainClick(event)) {
                            return;
                        }

                        // No hover on a phone: the first tap opens the worktrees, the next one chooses.
                        if (
                            pointer.current !== "mouse" &&
                            event.currentTarget.dataset["state"] !== "open"
                        ) {
                            return;
                        }

                        // Without preventDefault Radix opens the submenu instead of choosing the folder.
                        event.preventDefault();
                        onPick(row.cwd);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && event.target === event.currentTarget) {
                            event.preventDefault();
                            onPick(row.cwd);
                        }
                    }}
                >
                    {icon}
                    {name}
                    <span className="text-faint text-meta">{row.count}</span>
                    <ChevronRight className="text-faint shrink-0" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-48">
                    {row.worktrees.map((worktree) => folderRow(worktree, true))}
                </DropdownMenuSubContent>
            </DropdownMenuSub>
        );
    };

    return (
        <DropdownMenu
            modal={false}
            open={scopeOpen}
            onOpenChange={(next) => {
                onScopeOpenChange(next);

                if (!next) {
                    setExpanded(null);
                }
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="min-w-0 flex-1 justify-start px-2 py-1">
                    <Folder className="text-faint size-3 shrink-0" />
                    <span className="text-meta text-muted min-w-0 flex-1 truncate text-left font-mono">
                        {scope}
                    </span>
                    <ChevronDown className="text-faint size-3.5 shrink-0" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <ScrollArea viewportProps={{ className: "max-h-72" }}>
                    <DropdownMenuItem
                        onSelect={() => {
                            onPickAll();
                        }}
                        ref={all ? chosen : undefined}
                        className={all ? "bg-raised" : "data-[highlighted]:bg-raised/50"}
                    >
                        <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                            All
                        </span>
                        <span className="text-faint text-meta">{count}</span>
                    </DropdownMenuItem>
                    {folders.map((row) => folderRow(row, false))}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
