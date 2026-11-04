import {
    Archive,
    ArchiveRestore,
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Folder,
    GitFork,
    MoreHorizontal,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Plus,
    Search,
    Trash2,
    X,
} from "lucide-react";
import {
    Fragment,
    type ReactNode,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { DAY, MINUTE, ago } from "@/lib/time.ts";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { type FolderSessionMenuItem, useSessionFilters, useSessionMenu } from "../extensions.ts";
import { fuzzyMatch, segments } from "../lib/fuzzy.ts";
import { isNarrow, isSheet, watchNarrow, watchSheet } from "../lib/narrow.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { cwdsOf, type FolderRow, folderRows, rowOf } from "../lib/session-folders.ts";
import { holdingRow, sidebarSessions, workingChildren } from "../lib/session-nesting.ts";
import { newestFirst } from "../lib/session-order.ts";
import { toast } from "../lib/toast.ts";
import { useShellCommand } from "../sdk/commands.ts";
import { focusComposer } from "../sdk/composer.ts";
import type { StatusProps } from "../sdk/types.ts";
import { CommandKeys } from "../ui/command-keys.tsx";
import { GroupHeading } from "../ui/group-heading.tsx";
import { ItemBoundary } from "../ui/item-boundary.tsx";
import { ResizeHandle } from "../ui/resize-handle.tsx";
import { folderName, SessionMarks, StateMark } from "./session-parts.tsx";
import { SidebarBottom } from "./sidebar-bottom.tsx";

/** An item's label and icon, which a folder may read off the row: pause turns into resume. */
function labelOf(item: FolderSessionMenuItem, session: SessionSummary): string {
    return typeof item.label === "function" ? item.label(session) : item.label;
}

/** A busy toast's title, with the spinner at the far end: Sonner's own loading slot cannot be placed here. */
function busyLabel(text: string): ReactNode {
    return (
        <span className="flex items-center gap-3">
            {text}
            <Spinner className="text-muted ml-auto shrink-0 motion-reduce:animate-none" />
        </span>
    );
}

function iconOf(
    part: ReactNode | ((session: SessionSummary) => ReactNode),
    session: SessionSummary,
): ReactNode {
    return typeof part === "function" ? part(session) : part;
}

type Props = {
    /** Every session, unfiltered: the rows leave out the ones started from another session in this list. */
    sessions: SessionSummary[];
    /** Null on the home page. */
    current: number | null;
    /** The open session as extensions see it, for the area under the list. */
    session: StatusProps["session"];
    /** The folder the list follows until one is picked: the open session's, or the last one's on the home page. */
    folder: string | null;
    onHome: () => void;
    onArchive: (id: number, archived: boolean) => Promise<void>;
    /** Out of the list for good: the row disappears, the transcript is never shown again. */
    onDelete: (id: number) => Promise<void>;
    /** An empty name returns the session to its automatic title. */
    onRename: (id: number, name: string) => Promise<void>;
    onSelect: (id: number) => void;
    /** A folder was picked in the filter: show its latest session, keeping the list open. */
    onFolder: (id: number) => void;
    onNew: () => void;
    /** Below `lg` the list is a full-screen sheet; this says whether it is showing. */
    open: boolean;
    onClose: () => void;
};

const GROUPS = ["Today", "Yesterday", "This week", "Older"] as const;

/** Calendar days, not 24-hour spans: a session from 23:50 is "Yesterday" at 00:10. */
function groupOf(at: number | null, now: number): (typeof GROUPS)[number] {
    if (at === null) {
        return "Older";
    }

    const midnight = new Date(now).setHours(0, 0, 0, 0);

    if (at >= midnight) {
        return "Today";
    }

    if (at >= midnight - DAY) {
        return "Yesterday";
    }

    return at >= midnight - 6 * DAY ? "This week" : "Older";
}

const COLLAPSED_KEY = "sidebarCollapsed";
/** Hides everything but the status marks and the toggle once the sidebar is a narrow rail. */
const FADE =
    "transition-opacity lg:group-data-[collapsed]/side:opacity-0 lg:group-data-[collapsed]/side:pointer-events-none";
/** Gives back the height of blocks that are invisible in the rail; overflow is clipped only then, so the folder menu can still open. */
const FOLD =
    "max-h-24 transition-[max-height,padding,border-width] lg:group-data-[collapsed]/side:max-h-0 lg:group-data-[collapsed]/side:overflow-hidden lg:group-data-[collapsed]/side:border-b-0 lg:group-data-[collapsed]/side:py-0 lg:group-data-[collapsed]/side:pt-0";
const WIDTH_KEY = "sidebarWidth";
const USUAL_WIDTH = 264;
const MIN_WIDTH = 204;
const MAX_WIDTH = 464;

function savedWidth(): number {
    const width = Number(localStorage.getItem(WIDTH_KEY));

    return width > 0 ? width : USUAL_WIDTH;
}

/** The stylesheet caps it at 40% of the screen as well, so the conversation keeps room. */
function setWidth(wanted: number, save: boolean): number {
    const max = Math.min(MAX_WIDTH, Math.max(USUAL_WIDTH, innerWidth * 0.4));
    const width = Math.round(Math.min(max, Math.max(MIN_WIDTH, wanted)));

    document.documentElement.style.setProperty("--sidebar-w", `${String(width)}px`);

    if (save) {
        localStorage.setItem(WIDTH_KEY, String(width));
    }

    return width;
}

const runKey = (item: FolderSessionMenuItem, session: SessionSummary): string =>
    `${String(session.id)}:${item.id}`;
/** One list for every row without a search, so a row whose title did not change gets an equal prop. */
const NO_RANGES: [number, number][] = [];

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

/** Mounted only while its popover is open, so a draft always starts from the session's current name. */
function RenameForm({
    id,
    name,
    pending,
    onSave,
    onCancel,
}: {
    id: number;
    name: string;
    pending: boolean;
    onSave: (id: number, name: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(name);

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                void onSave(id, draft);
            }}
            className="flex flex-col gap-2"
        >
            <label className="text-meta text-muted" htmlFor="rename-session">
                Session name
            </label>
            <Input
                id="rename-session"
                maxLength={80}
                value={draft}
                placeholder="Leave empty for automatic name"
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                className="border-edge-soft bg-canvas text-ui"
            />
            <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending} className="font-normal">
                    Save
                </Button>
            </div>
        </form>
    );
}

// Every prop is a primitive, a row object that keeps its identity until the row changes, or a callback
// that Sessions keeps stable: a session-list event then re-renders only the rows it touched.
const SessionRow = memo(function SessionRow({
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
                                        onRename(session);
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

export const Sessions = memo(function Sessions({
    sessions,
    current,
    session: activeSession,
    folder: openFolder,
    onHome,
    onSelect,
    onArchive,
    onDelete,
    onRename,
    onFolder,
    onNew,
    open: sheet,
    onClose,
}: Props) {
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
    const toggleCollapsed = (): void => {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
        setCollapsed(!collapsed);
    };
    const [archived, setArchived] = useState(false);
    const [all, setAll] = useState(true);
    // What each filter extension keeps, by id; a filter that goes away takes its entry with it.
    const [kept, setKept] = useState<
        Readonly<Record<string, ((session: SessionSummary) => boolean) | undefined>>
    >({});
    // A folder picked by hand holds until "All": opening a session in a worktree does not move the list.
    const [chosenCwd, setChosenCwd] = useState<string | null>(null);
    const [scopeOpen, setScopeOpen] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const narrow = useSyncExternalStore(watchNarrow, isNarrow);
    const asSheet = useSyncExternalStore(watchSheet, isSheet);
    const chosen = useRef<HTMLDivElement | null>(null);

    useShellCommand("folder.pick", () => {
        localStorage.setItem(COLLAPSED_KEY, "0");
        setCollapsed(false);
        setScopeOpen(true);
        // Opened from the keyboard, the menu marks its first row; the folder in use takes the mark after.
        setTimeout(() => {
            chosen.current?.focus();
        }, 0);
    });
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const searchBox = useRef<HTMLInputElement>(null);
    // Where a hotkey found the focus, so Escape gives it back there instead of to the search button.
    const searchFrom = useRef<HTMLElement | null>(null);

    useShellCommand("session.search", () => {
        if (document.activeElement !== searchBox.current) {
            searchFrom.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        localStorage.setItem(COLLAPSED_KEY, "0");
        setCollapsed(false);
        setSearching(true);
        searchBox.current?.focus();
    });
    const searchTrigger = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const stopSearch = useCallback((): void => {
        setSearching(false);
        setQuery("");
        // The box is only hidden, not unmounted, so it would keep the keys pressed after Escape.
        const back = searchFrom.current?.isConnected ? searchFrom.current : searchTrigger.current;

        searchFrom.current = null;
        back?.focus();
    }, []);
    const openRow = useCallback(
        (id: number): void => {
            onSelect(id);
            stopSearch();
        },
        [onSelect, stopSearch],
    );
    const [pending, setPending] = useState(false);
    const [deleting, setDeleting] = useState<SessionSummary | null>(null);
    const menu = useSessionMenu();
    const filters = useSessionFilters();
    const setters = useMemo(() => {
        const made = new Map<
            string,
            (match: ((session: SessionSummary) => boolean) | null) => void
        >();

        for (const { id } of filters) {
            made.set(id, (match) => {
                setKept((held) => ({ ...held, [id]: match ?? undefined }));
            });
        }

        return made;
    }, [filters]);
    const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
    const runMenuItem = useCallback(
        (item: FolderSessionMenuItem, session: SessionSummary): void => {
            const run = item.run;
            if (run === undefined) {
                return;
            }

            const key = runKey(item, session);
            const markRunning = (on: boolean): void => {
                setRunning((keys) => {
                    const next = new Set(keys);
                    if (on) {
                        next.add(key);
                    } else {
                        next.delete(key);
                    }

                    return next;
                });
            };

            markRunning(true);
            toast.promise(run(session.id), {
                loading: busyLabel(`${labelOf(item, session)}…`),
                error: (error: unknown) =>
                    error instanceof Error ? error.message : "Could not finish the action.",
                finally: () => {
                    markRunning(false);
                },
            });
        },
        [],
    );
    const [renaming, setRenaming] = useState<number | null>(null);
    // The rename form lives in the row's popover, so a session the list draws no row for — one started
    // from another, or one the folder, archive or search filter hides — is renamed in a dialog instead,
    // and while that dialog is open no row opens its own: one form, one `#rename-session`.
    const [unanchored, setUnanchored] = useState(false);
    // The fallback has no trigger, so Radix has nothing to hand the focus back to: it remembers instead.
    const renameReturn = useRef<HTMLElement | null>(null);
    const shell = useRef<HTMLElement | null>(null);
    // The rows on screen, so `session.rename` can bring its row into view before opening the form.
    const rowNodes = useRef(new Map<number, HTMLDivElement>());
    const registerRow = useCallback((id: number, node: HTMLDivElement | null): void => {
        if (node === null) {
            rowNodes.current.delete(id);
        } else {
            rowNodes.current.set(id, node);
        }
    }, []);
    const startRename = useCallback((target: SessionSummary): void => {
        setUnanchored(false);
        setRenaming(target.id);
    }, []);

    useShellCommand("session.rename", () => {
        const target = sessions.find((session) => session.id === current);

        if (target !== undefined) {
            const row = rowNodes.current.get(target.id);

            row?.scrollIntoView({ block: "nearest" });
            renameReturn.current =
                row === undefined && document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
            setUnanchored(row === undefined);
            setRenaming(target.id);
        }
    });

    const saveName = useCallback(
        async (id: number, name: string): Promise<void> => {
            setPending(true);
            try {
                await onRename(id, name);
                setRenaming(null);
                toast.success("Session renamed");
            } catch {
                toast.error("Could not rename the session. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onRename],
    );
    const stopRenaming = useCallback((): void => {
        setRenaming(null);
    }, []);
    const changeArchive = useCallback(
        async (id: number, value: boolean): Promise<void> => {
            setPending(true);
            try {
                await onArchive(id, value);
                toast.success(value ? "Session archived" : "Session restored", {
                    id: `archive-${String(id)}`,
                    duration: 4000,
                    action: {
                        label: "Undo",
                        onClick: () => {
                            toast.promise(onArchive(id, !value), {
                                loading: busyLabel("Undoing…"),
                                success: value ? "Session restored" : "Session archived",
                                error: "Could not undo. Please try again.",
                            });
                        },
                    },
                });
            } catch {
                toast.error("Could not update the archive. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onArchive],
    );
    const confirmDelete = useCallback(
        async (id: number): Promise<void> => {
            setPending(true);
            try {
                await onDelete(id);
                setDeleting(null);
                toast.success("Session deleted");
            } catch {
                toast.error("Could not delete the session. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onDelete],
    );
    const cancelDelete = useCallback((): void => {
        setDeleting(null);
    }, []);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        setWidth(savedWidth(), false);
    }, []);

    useEffect(() => {
        if (searching) {
            searchBox.current?.focus();
        }
    }, [searching]);

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    // Checked against the full list, before the folder, archive and search filters below.
    const topLevel = sidebarSessions(sessions);
    const folder = chosenCwd ?? openFolder;
    const holding = holdingRow(current, sessions);
    const folders = folderRows(topLevel);

    const latest = (cwds: readonly string[]): SessionSummary[] =>
        topLevel
            .filter((session) => session.cwd !== null && cwds.includes(session.cwd))
            .toSorted(newestFirst);
    // A folder with worktrees shows theirs too; a worktree shows only its own.
    const picked = rowOf(folders, folder);
    const scopeCwds = picked === undefined ? (folder === null ? [] : [folder]) : cwdsOf(picked);
    const scope = all
        ? "All"
        : picked !== undefined && picked.under !== null
          ? `${folderName(picked.under)} / ${folderName(folder)}`
          : folderName(folder);

    // Which kind of pointer chose, so a phone's first tap can open the worktrees instead of choosing.
    const pointer = useRef("mouse");
    const holds = (row: FolderRow, cwd: string | null): boolean =>
        cwd !== null && (row.cwd === cwd || row.worktrees.some((child) => holds(child, cwd)));
    const pickFolder = (cwd: string): void => {
        setAll(false);
        setChosenCwd(cwd);

        const [first] = latest([cwd]);

        if (first !== undefined) {
            onFolder(first.id);
        }

        setScopeOpen(false);
    };
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
                        pickFolder(row.cwd);
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
                                pickFolder(row.cwd);

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
                        pickFolder(row.cwd);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && event.target === event.currentTarget) {
                            event.preventDefault();
                            pickFolder(row.cwd);
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

    const keptBy = filters.flatMap(({ id }) => {
        const match = kept[id];

        return match === undefined ? [] : [match];
    });

    const matches = (all ? topLevel.toSorted(newestFirst) : latest(scopeCwds))
        .filter((session) => session.archived === archived)
        .filter((session) => keptBy.every((match) => match(session)))
        .flatMap((session) => {
            const match = fuzzyMatch(session.title ?? "New session", query);

            return match === null ? [] : [{ session, score: match.score, ranges: match.ranges }];
        })
        // Without a query every score is equal, so the newest stays first either way.
        .toSorted(
            (left, right) => right.score - left.score || newestFirst(left.session, right.session),
        );
    const shown = matches.map((match) => match.session);
    const hits = new Map(matches.map((match) => [match.session.id, match.ranges]));
    const rangesOf = (id: number): [number, number][] => {
        const ranges = hits.get(id);

        return ranges === undefined || ranges.length === 0 ? NO_RANGES : ranges;
    };
    // The rows in the order they are drawn, so stepping follows the folder, archive and search filters.
    const visible = GROUPS.flatMap((group) =>
        shown.filter((session) => groupOf(session.activeAt, now) === group),
    );
    const stepTo = (step: 1 | -1): void => {
        const at = visible.findIndex((session) => session.id === (holding ?? current));
        const index =
            at === -1
                ? step === 1
                    ? 0
                    : visible.length - 1
                : (at + step + visible.length) % visible.length;
        const target = visible[index];

        if (target !== undefined) {
            onSelect(target.id);
        }
    };

    useShellCommand("session.prev", () => {
        stepTo(-1);
    });
    useShellCommand("session.next", () => {
        stepTo(1);
    });

    // The sheet's dialog needs a title; the column has no dialog, so there it stays a plain heading.
    const Heading = asSheet ? SheetTitle : "h2";
    const aside = (
        // 37px, not a step: the collapsed rail is 6 + a 24px row + 6, plus the 1px border.
        <aside
            ref={shell}
            data-collapsed={collapsed ? "" : undefined}
            className={`group/side border-edge-soft bg-panel flex shrink-0 flex-col border-r in-[.resizing]:transition-none lg:relative lg:w-[min(var(--sidebar-w,264px),max(264px,40vw))] lg:transition-[width] lg:duration-200 lg:ease-out lg:data-[collapsed]:w-[37px] ${
                asSheet ? "min-h-0 flex-1 border-r-0" : ""
            }`}
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <header className="border-edge-soft relative flex items-center gap-2 px-3 py-2.5 transition-[padding] duration-200 lg:group-data-[collapsed]/side:flex-col lg:group-data-[collapsed]/side:gap-1 lg:group-data-[collapsed]/side:border-b lg:group-data-[collapsed]/side:px-1.5">
                    {/* The rail has room for one button: there the logo expands, and shows it on hover. */}
                    <Hint label="Expand sidebar">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Expand sidebar"
                            onClick={toggleCollapsed}
                            className="group/logo hidden size-6 shrink-0 lg:group-data-[collapsed]/side:inline-flex"
                        >
                            <img
                                src="/favicon.png"
                                alt=""
                                className="size-5 group-hover/logo:hidden group-focus-visible/logo:hidden"
                            />
                            <PanelLeftOpen className="hidden size-4 group-hover/logo:block group-focus-visible/logo:block" />
                        </Button>
                    </Hint>
                    <Hint label="Home: every session">
                        <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            className="relative -my-1 -ml-1 size-8 shrink-0 lg:group-data-[collapsed]/side:hidden"
                        >
                            <a
                                href={sessionHref(null)}
                                onClick={(event) => {
                                    if (isPlainClick(event)) {
                                        event.preventDefault();
                                        onHome();
                                    }
                                }}
                                aria-label="Home"
                                aria-current={current === null ? "page" : undefined}
                            >
                                <img src="/favicon.png" alt="" className="size-6" />
                                {current === null ? (
                                    <span
                                        aria-hidden
                                        className="bg-accent absolute inset-x-0 bottom-0 h-0.5"
                                    />
                                ) : null}
                            </a>
                        </Button>
                    </Hint>
                    <Heading
                        className={`text-ui text-ink min-w-0 flex-1 overflow-hidden font-medium whitespace-nowrap lg:group-data-[collapsed]/side:hidden ${FADE}`}
                    >
                        Sessions
                    </Heading>
                    <div className="flex items-center gap-1 lg:group-data-[collapsed]/side:hidden">
                        <Hint label="New session">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="New session"
                                onClick={onNew}
                            >
                                <Plus className="size-4" />
                            </Button>
                        </Hint>
                        <Hint
                            label="Search sessions"
                            keys={<CommandKeys command="session.search" />}
                        >
                            <Button
                                ref={searchTrigger}
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Search sessions"
                                aria-expanded={searching}
                                onClick={() => {
                                    setSearching(true);
                                }}
                            >
                                <Search className="size-4" />
                            </Button>
                        </Hint>
                        <Hint label="Collapse sidebar">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Collapse sidebar"
                                onClick={toggleCollapsed}
                                className="hidden shrink-0 lg:inline-flex"
                            >
                                <PanelLeftClose className="size-4" />
                            </Button>
                        </Hint>
                        <Hint label="Close">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Close"
                                onClick={onClose}
                                className="lg:hidden"
                            >
                                <X className="size-4" />
                            </Button>
                        </Hint>
                    </div>
                    <div
                        className={`bg-panel absolute inset-0 flex items-center px-3 py-2 transition-opacity duration-200 lg:group-data-[collapsed]/side:hidden ${searching ? "opacity-100" : "pointer-events-none opacity-0"}`}
                    >
                        <Search className="text-faint pointer-events-none absolute left-5 size-3.5" />
                        <Input
                            ref={searchBox}
                            type="search"
                            value={query}
                            aria-label="Search sessions"
                            placeholder={`Search in ${scope}`}
                            tabIndex={searching ? undefined : -1}
                            onChange={(event) => {
                                setQuery(event.target.value);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    // The key is this field's: it must not also leave the panel's full screen.
                                    event.stopPropagation();
                                    stopSearch();
                                }
                            }}
                            className="border-edge-soft text-ui h-full pr-7 pl-7 [&::-webkit-search-cancel-button]:hidden"
                        />
                        <Hint label="Close search">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Close search"
                                onClick={stopSearch}
                                tabIndex={searching ? undefined : -1}
                                className="absolute top-1/2 right-4.5 -translate-y-1/2"
                            >
                                <X className="size-3.5" />
                            </Button>
                        </Hint>
                    </div>
                </header>

                <div
                    className={`border-edge-soft flex items-center gap-1 border-b px-1.5 py-1 ${FADE} ${FOLD}`}
                >
                    <DropdownMenu
                        modal={false}
                        open={scopeOpen}
                        onOpenChange={(next) => {
                            setScopeOpen(next);

                            if (!next) {
                                setExpanded(null);
                            }
                        }}
                    >
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                className="min-w-0 flex-1 justify-start px-2 py-1"
                            >
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
                                        setAll(true);
                                        setChosenCwd(null);
                                    }}
                                    ref={all ? chosen : undefined}
                                    className={
                                        all ? "bg-raised" : "data-[highlighted]:bg-raised/50"
                                    }
                                >
                                    <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                                        All
                                    </span>
                                    <span className="text-faint text-meta">{topLevel.length}</span>
                                </DropdownMenuItem>
                                {folders.map((row) => folderRow(row, false))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="flex items-center">
                        {filters.map((item) => {
                            const setMatch = setters.get(item.id);
                            const Filter = item.component;

                            return setMatch === undefined ? null : (
                                <ItemBoundary
                                    key={`${item.folder}:${item.id}`}
                                    name={`${item.folder}:${item.id}`}
                                >
                                    <Filter setMatch={setMatch} />
                                </ItemBoundary>
                            );
                        })}
                        <Hint label={archived ? "Back to sessions" : "Show archived sessions"}>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={
                                    archived ? "Back to sessions" : "Show archived sessions"
                                }
                                aria-pressed={archived}
                                className={archived ? "bg-raised text-ink" : ""}
                                onClick={() => {
                                    setArchived(!archived);
                                }}
                            >
                                {archived ? (
                                    <ArrowLeft className="size-4" />
                                ) : (
                                    <Archive className="size-4" />
                                )}
                            </Button>
                        </Hint>
                    </div>
                </div>

                <ScrollArea ref={list} className="min-h-0 flex-1">
                    <nav className="p-1.5">
                        {shown.length === 0 ? (
                            <Empty
                                className="px-2 py-3"
                                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `output` is a calculation's result, and this is what a filter found
                                role="status"
                            >
                                {archived
                                    ? "No archived sessions"
                                    : query.trim() === ""
                                      ? "No sessions"
                                      : "No sessions match"}
                            </Empty>
                        ) : null}
                        {GROUPS.map((group) => {
                            const rows = shown.filter(
                                (session) => groupOf(session.activeAt, now) === group,
                            );

                            if (rows.length === 0) {
                                return null;
                            }

                            return (
                                <div key={group}>
                                    <Separator
                                        decorative={false}
                                        className={`mx-2 mt-1 mb-0.5 w-auto [:first-child>&]:hidden ${FADE} ${FOLD}`}
                                    />
                                    <GroupHeading className={`${FADE} ${FOLD}`}>
                                        {group} {rows.length}
                                    </GroupHeading>

                                    {rows.map((session) => (
                                        <SessionRow
                                            key={session.id}
                                            session={session}
                                            working={workingChildren(session.id, sessions)}
                                            time={
                                                session.activeAt === null
                                                    ? null
                                                    : ago(session.activeAt, now)
                                            }
                                            ranges={rangesOf(session.id)}
                                            current={session.id === current}
                                            holding={session.id === holding}
                                            menu={menu}
                                            running={running}
                                            pending={pending}
                                            renaming={renaming === session.id && !unanchored}
                                            registerRow={registerRow}
                                            onOpen={openRow}
                                            onRunItem={runMenuItem}
                                            onRename={startRename}
                                            onRenameSave={saveName}
                                            onRenameCancel={stopRenaming}
                                            onArchive={changeArchive}
                                            onDelete={setDeleting}
                                            deleting={deleting?.id === session.id}
                                            onConfirmDelete={confirmDelete}
                                            onCancelDelete={cancelDelete}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </nav>
                </ScrollArea>
                <SidebarBottom
                    list={list}
                    session={activeSession}
                    sessions={sessions}
                    openSession={onSelect}
                />
            </div>

            {unanchored && renaming !== null ? (
                <Dialog
                    open
                    onOpenChange={(open) => {
                        if (!open) {
                            stopRenaming();
                        }
                    }}
                >
                    <DialogContent
                        aria-describedby={undefined}
                        className="bg-panel text-meta sm:max-w-sm"
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();

                            const back = renameReturn.current;

                            if (back !== null && back.isConnected) {
                                back.focus();

                                return;
                            }

                            // What held it is gone: the composer takes the caret when there is one.
                            focusComposer();
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Rename session</DialogTitle>
                        </DialogHeader>
                        <div className="p-3">
                            <RenameForm
                                id={renaming}
                                name={
                                    sessions.find((session) => session.id === renaming)?.name ?? ""
                                }
                                pending={pending}
                                onSave={saveName}
                                onCancel={stopRenaming}
                            />
                        </div>
                    </DialogContent>
                </Dialog>
            ) : null}

            {collapsed ? null : (
                <ResizeHandle
                    edge="right"
                    label="Resize sidebar"
                    onResize={setWidth}
                    base={savedWidth}
                    onReset={() => {
                        localStorage.removeItem(WIDTH_KEY);
                        setWidth(USUAL_WIDTH, false);
                    }}
                />
            )}
        </aside>
    );

    return asSheet ? (
        <Sheet
            open={sheet}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <SheetContent
                side="full"
                aria-describedby={undefined}
                // The search box closes itself on Escape; the sheet closes on the next one.
                onEscapeKeyDown={(event) => {
                    if (document.activeElement === searchBox.current && searching) {
                        event.preventDefault();
                    }
                }}
                className="border-l-0"
            >
                {aside}
            </SheetContent>
        </Sheet>
    ) : (
        aside
    );
});
