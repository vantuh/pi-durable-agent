import {
    Archive,
    ArchiveRestore,
    ArrowLeft,
    ChevronDown,
    Folder,
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
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { type FolderSessionMenuItem, useSessionMenu } from "../extensions.ts";
import { fuzzyMatch, segments } from "../lib/fuzzy.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { holdingRow, sidebarSessions, workingChildren } from "../lib/session-nesting.ts";
import { toast } from "../lib/toast.ts";
import { useShellCommand } from "../sdk/commands.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ago, DAY, folderName, MINUTE, StateMark } from "./session-parts.tsx";
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
    /** The folder the list shows: the open session's, or the last one's on the home page. */
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

/** Drag the sidebar's right edge, or press the arrow keys on it, to resize it; a double click resets it. */
function ResizeHandle() {
    const start = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        const handle = event.currentTarget;
        const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
        const root = document.documentElement;
        let width: number | null = null;

        const move = (each: PointerEvent): void => {
            width = setWidth(each.clientX - left, false);
        };

        // Fires after pointerup and pointercancel alike, so one listener ends the drag.
        const stop = (): void => {
            root.classList.remove("resizing");
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("lostpointercapture", stop);

            if (width !== null) {
                setWidth(width, true);
            }
        };

        root.classList.add("resizing");
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", stop);
    };

    return (
        <button
            type="button"
            aria-label="Resize sidebar"
            title="Drag to resize, double-click to reset"
            onPointerDown={start}
            onKeyDown={(event) => {
                const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];

                if (step !== undefined) {
                    event.preventDefault();
                    setWidth(savedWidth() + step, true);
                }
            }}
            onDoubleClick={() => {
                localStorage.removeItem(WIDTH_KEY);
                setWidth(USUAL_WIDTH, false);
            }}
            className="group absolute inset-y-0 -right-2 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
        >
            <span className="bg-accent absolute top-1/2 left-[3px] h-9 w-0.5 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
        </button>
    );
}

export function Sessions({
    sessions,
    current,
    session: activeSession,
    folder,
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
    const [archived, setArchived] = useState(false);
    const [all, setAll] = useState(true);
    const [scopeOpen, setScopeOpen] = useState(false);
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
    const searchTrigger = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const stopSearch = (): void => {
        setSearching(false);
        setQuery("");
        // The box is only hidden, not unmounted, so it would keep the keys pressed after Escape.
        searchTrigger.current?.focus();
    };
    const [pending, setPending] = useState(false);
    const [deleting, setDeleting] = useState<SessionSummary | null>(null);
    const menu = useSessionMenu();
    const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
    const runKey = (item: FolderSessionMenuItem, session: SessionSummary): string =>
        `${String(session.id)}:${item.id}`;
    const markRunning = (key: string, on: boolean): void => {
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
    const runMenuItem = (item: FolderSessionMenuItem, session: SessionSummary): void => {
        const key = runKey(item, session);
        markRunning(key, true);
        toast.promise(item.run(session.id), {
            loading: busyLabel(`${labelOf(item, session)}…`),
            error: (error: unknown) =>
                error instanceof Error ? error.message : "Could not finish the action.",
            finally: () => {
                markRunning(key, false);
            },
        });
    };
    const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
    const saveName = async (): Promise<void> => {
        if (renaming === null) {
            return;
        }

        setPending(true);
        try {
            await onRename(renaming.id, renaming.name);
            setRenaming(null);
            toast.success("Session renamed");
        } catch {
            toast.error("Could not rename the session. Please try again.");
        } finally {
            setPending(false);
        }
    };
    const changeArchive = async (id: number, value: boolean): Promise<void> => {
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
    };
    const remove = async (id: number): Promise<void> => {
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
    };
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
    const holding = holdingRow(current, sessions);
    const folders = new Map<string, number>();
    const lastUse = new Map<string, number>();

    for (const session of topLevel) {
        if (session.cwd !== null) {
            folders.set(session.cwd, (folders.get(session.cwd) ?? 0) + 1);
            lastUse.set(
                session.cwd,
                Math.max(lastUse.get(session.cwd) ?? 0, session.activeAt ?? 0),
            );
        }
    }

    // The folder worked in last first; the path breaks ties, so equal times do not swap rows.
    const ordered = [...folders].toSorted(
        ([left], [right]) =>
            (lastUse.get(right) ?? 0) - (lastUse.get(left) ?? 0) || left.localeCompare(right),
    );

    const newest = (rows: SessionSummary[]): SessionSummary[] =>
        rows.toSorted((left, right) => (right.activeAt ?? 0) - (left.activeAt ?? 0));
    const latest = (cwd: string | null): SessionSummary[] =>
        newest(topLevel.filter((session) => session.cwd === cwd));
    const scope = all ? "All" : folderName(folder);

    const matches = (all ? newest(topLevel) : latest(folder))
        .filter((session) => session.archived === archived)
        .flatMap((session) => {
            const match = fuzzyMatch(session.title ?? "New session", query);

            return match === null ? [] : [{ session, score: match.score, ranges: match.ranges }];
        })
        // Without a query every score is equal, so the newest stays first either way.
        .toSorted(
            (left, right) =>
                right.score - left.score ||
                (right.session.activeAt ?? 0) - (left.session.activeAt ?? 0),
        );
    const shown = matches.map((match) => match.session);
    const hits = new Map(matches.map((match) => [match.session.id, match.ranges]));
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

    return (
        <aside
            data-collapsed={collapsed ? "" : undefined}
            className={`group/side rounded-card border-edge-soft bg-canvas shrink-0 flex-col border in-[.resizing]:transition-none lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-[min(var(--sidebar-w,264px),max(264px,40vw))] lg:transition-[width] lg:duration-200 lg:ease-out lg:data-[collapsed]:w-[38px] ${
                sheet ? "fixed inset-2 z-30 flex" : "hidden"
            }`}
        >
            <div className="rounded-card flex min-h-0 flex-1 flex-col overflow-hidden">
                <header className="border-edge-soft flex items-center gap-2 border-b px-3 py-2.5 transition-[padding] duration-200 lg:group-data-[collapsed]/side:flex-col lg:group-data-[collapsed]/side:gap-1 lg:group-data-[collapsed]/side:px-[6px]">
                    <a
                        href={sessionHref(null)}
                        onClick={(event) => {
                            if (isPlainClick(event)) {
                                event.preventDefault();
                                onHome();
                            }
                        }}
                        title="Home: every session"
                        aria-label="Home"
                        aria-current={current === null ? "page" : undefined}
                        className={`rounded-control -my-1 -ml-1 flex size-8 shrink-0 items-center justify-center lg:group-data-[collapsed]/side:my-0 lg:group-data-[collapsed]/side:ml-0 lg:group-data-[collapsed]/side:size-6 ${current === null ? "bg-raised" : "hover:bg-raised"}`}
                    >
                        <img
                            src="/favicon.png"
                            alt=""
                            className="size-6 lg:group-data-[collapsed]/side:size-5"
                        />
                    </a>
                    <h2
                        className={`text-sidebar text-ink min-w-0 flex-1 overflow-hidden font-medium whitespace-nowrap lg:group-data-[collapsed]/side:hidden ${FADE}`}
                    >
                        Sessions
                    </h2>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
                                setCollapsed(!collapsed);
                            }}
                            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                            className="rounded-control text-muted hover:bg-raised hover:text-ink hidden size-6 shrink-0 items-center justify-center lg:flex"
                        >
                            {collapsed ? (
                                <PanelLeftOpen className="size-4" />
                            ) : (
                                <PanelLeftClose className="size-4" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title="Close"
                            className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center lg:hidden"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </header>

                <div className={`border-edge-soft border-b ${FADE} ${FOLD}`}>
                    <DropdownMenu modal={false} open={scopeOpen} onOpenChange={setScopeOpen}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="hover:bg-raised flex w-full items-center gap-1.5 px-3 py-2"
                            >
                                <Folder className="text-faint size-3 shrink-0" />
                                <span className="text-meta text-muted min-w-0 flex-1 truncate text-left font-mono">
                                    {scope}
                                </span>
                                <ChevronDown className="text-faint size-3.5 shrink-0" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-(--radix-dropdown-menu-trigger-width)"
                        >
                            <ScrollArea viewportProps={{ className: "max-h-72" }}>
                                <DropdownMenuItem
                                    onSelect={() => {
                                        setAll(true);
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
                                {ordered.map(([cwd, count]) => (
                                    <DropdownMenuItem
                                        key={cwd}
                                        title={cwd}
                                        onSelect={() => {
                                            setAll(false);

                                            const [first] = latest(cwd);

                                            if (first !== undefined) {
                                                onFolder(first.id);
                                            }
                                        }}
                                        ref={!all && cwd === folder ? chosen : undefined}
                                        className={
                                            !all && cwd === folder
                                                ? "bg-raised"
                                                : "data-[highlighted]:bg-raised/50"
                                        }
                                    >
                                        <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                                            {folderName(cwd)}
                                        </span>
                                        <span className="text-faint text-meta">{count}</span>
                                    </DropdownMenuItem>
                                ))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className={`flex items-stretch gap-1 px-3 pt-3 ${FADE} ${FOLD}`}>
                    <div className="relative min-w-0 flex-1">
                        <button
                            type="button"
                            onClick={onNew}
                            tabIndex={searching ? -1 : undefined}
                            className={`rounded-control border-edge bg-sunken text-ink hover:bg-raised flex w-full items-center justify-center gap-2 border py-2.5 transition-opacity duration-200 ${searching ? "pointer-events-none opacity-0" : "opacity-100"}`}
                        >
                            <Plus className="size-4" />
                            <span className="text-sidebar">New session</span>
                        </button>
                        <div
                            className={`absolute inset-0 transition-[opacity,transform] duration-200 ${searching ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-2 opacity-0"}`}
                        >
                            <Search className="text-faint pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                            <input
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
                                        stopSearch();
                                    }
                                }}
                                className="rounded-control border-edge-soft bg-sunken text-sidebar text-ink placeholder:text-faint focus:border-accent h-full w-full border pr-7 pl-7 outline-none [&::-webkit-search-cancel-button]:hidden"
                            />
                            <button
                                type="button"
                                onClick={stopSearch}
                                title="Close search"
                                aria-label="Close search"
                                tabIndex={searching ? undefined : -1}
                                className="rounded-control text-muted hover:bg-raised hover:text-ink absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    </div>
                    <button
                        ref={searchTrigger}
                        type="button"
                        onClick={() => {
                            if (searching) {
                                stopSearch();
                            } else {
                                setSearching(true);
                            }
                        }}
                        title="Search sessions"
                        aria-label="Search sessions"
                        aria-expanded={searching}
                        aria-hidden={searching ? true : undefined}
                        tabIndex={searching ? -1 : undefined}
                        className={`rounded-control border-edge-soft bg-sunken text-muted hover:bg-raised hover:text-ink flex shrink-0 items-center justify-center overflow-hidden border transition-[width,opacity] duration-200 ${searching ? "pointer-events-none w-0 border-transparent opacity-0" : "w-9 opacity-100"}`}
                    >
                        <Search className="size-4" />
                    </button>
                </div>

                <div className={`flex items-center justify-between px-3 pt-2 ${FADE} ${FOLD}`}>
                    <span className="text-meta text-muted">
                        {archived
                            ? "Archive"
                            : query.trim() === ""
                              ? "Sessions"
                              : `${String(shown.length)} found`}
                    </span>
                    <button
                        type="button"
                        title={archived ? "Back to sessions" : "Show archived sessions"}
                        aria-label={archived ? "Back to sessions" : "Show archived sessions"}
                        aria-pressed={archived}
                        onClick={() => {
                            setArchived(!archived);
                        }}
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-7 items-center justify-center"
                    >
                        {archived ? (
                            <ArrowLeft className="size-4" />
                        ) : (
                            <Archive className="size-4" />
                        )}
                    </button>
                </div>
                <ScrollArea ref={list} className="min-h-0 flex-1">
                    <nav className="p-1.5">
                        {shown.length === 0 ? (
                            <p className="text-meta text-faint px-2 py-3">
                                {archived
                                    ? "No archived sessions"
                                    : query.trim() === ""
                                      ? "No sessions"
                                      : "No sessions match"}
                            </p>
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
                                    <div
                                        className={`text-faint text-meta px-2 py-1.5 whitespace-nowrap ${FADE} ${FOLD}`}
                                    >
                                        {group} {rows.length}
                                    </div>

                                    {rows.map((session) => {
                                        return (
                                            <div
                                                key={session.id}
                                                data-holds-open={
                                                    session.id === holding ? "" : undefined
                                                }
                                                className={`session-row group rounded-control relative flex items-center ${session.id === current || session.id === holding ? "bg-raised" : "hover:bg-raised/50"}`}
                                            >
                                                <a
                                                    href={sessionHref(session.id)}
                                                    onClick={(event) => {
                                                        if (!isPlainClick(event)) {
                                                            return;
                                                        }

                                                        event.preventDefault();
                                                        onSelect(session.id);
                                                        stopSearch();
                                                    }}
                                                    aria-current={
                                                        session.id === current
                                                            ? "page"
                                                            : session.id === holding
                                                              ? "true"
                                                              : undefined
                                                    }
                                                    className="rounded-control flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                                                >
                                                    <StateMark
                                                        session={session}
                                                        working={workingChildren(
                                                            session.id,
                                                            sessions,
                                                        )}
                                                    />
                                                    <span
                                                        className={`text-sidebar text-ink min-w-0 flex-1 truncate ${FADE}`}
                                                    >
                                                        {segments(
                                                            session.title ?? "New session",
                                                            hits.get(session.id) ?? [],
                                                        ).map((part, index) => (
                                                            <span
                                                                key={`${String(index)}-${part.text}`}
                                                                className={
                                                                    part.hit
                                                                        ? "bg-warn/30 text-ink rounded-[2px]"
                                                                        : undefined
                                                                }
                                                            >
                                                                {part.text}
                                                            </span>
                                                        ))}
                                                    </span>
                                                    <span
                                                        className={`session-time text-faint text-meta min-w-7 shrink-0 text-right ${FADE}`}
                                                    >
                                                        {session.activeAt === null
                                                            ? null
                                                            : ago(session.activeAt, now)}
                                                    </span>
                                                </a>
                                                <DropdownMenu modal={false}>
                                                    <DropdownMenuTrigger asChild>
                                                        <button
                                                            type="button"
                                                            aria-label={`Actions for ${session.title ?? "New session"}`}
                                                            title="Session actions"
                                                            className="session-actions rounded-control text-muted hover:bg-panel hover:text-ink absolute right-1 flex size-7 items-center justify-center lg:group-data-[collapsed]/side:hidden"
                                                        >
                                                            <MoreHorizontal className="size-4" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        onCloseAutoFocus={(event) => {
                                                            event.preventDefault();
                                                        }}
                                                    >
                                                        {menu.map((item) => (
                                                            <DropdownMenuItem
                                                                key={item.id}
                                                                disabled={running.has(
                                                                    runKey(item, session),
                                                                )}
                                                                onSelect={() => {
                                                                    runMenuItem(item, session);
                                                                }}
                                                            >
                                                                {iconOf(item.icon, session)}
                                                                {labelOf(item, session)}
                                                            </DropdownMenuItem>
                                                        ))}
                                                        {menu.length === 0 ? null : (
                                                            <DropdownMenuSeparator />
                                                        )}
                                                        <DropdownMenuItem
                                                            onSelect={() => {
                                                                setRenaming({
                                                                    id: session.id,
                                                                    name: session.name ?? "",
                                                                });
                                                            }}
                                                        >
                                                            <Pencil />
                                                            Rename
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={pending}
                                                            onSelect={() => {
                                                                void changeArchive(
                                                                    session.id,
                                                                    !session.archived,
                                                                );
                                                            }}
                                                        >
                                                            {session.archived ? (
                                                                <ArchiveRestore />
                                                            ) : (
                                                                <Archive />
                                                            )}
                                                            {session.archived
                                                                ? "Restore"
                                                                : "Archive"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onSelect={() => {
                                                                setDeleting(session);
                                                            }}
                                                        >
                                                            <Trash2 />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        );
                                    })}
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

            {renaming === null ? null : (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void saveName();
                    }}
                    className="rounded-card border-edge-soft bg-panel absolute inset-x-2 top-14 z-20 flex flex-col gap-2 border p-2 shadow-lg lg:inset-x-auto lg:left-full lg:ml-2 lg:w-64"
                >
                    <label className="text-meta text-muted" htmlFor="rename-session">
                        Session name
                    </label>
                    <input
                        id="rename-session"
                        ref={(node) => {
                            node?.focus();
                        }}
                        maxLength={80}
                        value={renaming.name}
                        placeholder="Leave empty for automatic name"
                        onChange={(event) => {
                            setRenaming({ id: renaming.id, name: event.target.value });
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                setRenaming(null);
                            }
                        }}
                        className="rounded-control border-edge-soft bg-canvas text-sidebar text-ink focus:border-accent border px-2 py-1.5 outline-none"
                    />
                    <div className="flex justify-end gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                setRenaming(null);
                            }}
                            className="rounded-control text-meta text-muted hover:bg-raised hover:text-ink px-2 py-1"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={pending}
                            className="rounded-control text-meta bg-accent text-canvas px-2 py-1 disabled:opacity-50"
                        >
                            Save
                        </button>
                    </div>
                </form>
            )}

            {deleting === null ? null : (
                <div
                    role="alertdialog"
                    aria-label="Delete session"
                    className="rounded-card border-edge-soft bg-panel absolute inset-x-2 top-14 z-20 flex flex-col gap-2 border p-2 shadow-lg lg:inset-x-auto lg:left-full lg:ml-2 lg:w-64"
                >
                    <p className="text-meta text-ink break-words">
                        Delete “{deleting.title ?? "New session"}”? It disappears for good.
                    </p>
                    <div className="flex justify-end gap-1">
                        <button
                            type="button"
                            ref={(node) => {
                                node?.focus();
                            }}
                            onClick={() => {
                                setDeleting(null);
                            }}
                            className="rounded-control text-meta text-muted hover:bg-raised hover:text-ink px-2 py-1"
                        >
                            No
                        </button>
                        <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                                void remove(deleting.id);
                            }}
                            className="rounded-control text-meta bg-danger text-canvas px-2 py-1 disabled:opacity-50"
                        >
                            Yes, delete
                        </button>
                    </div>
                </div>
            )}

            {collapsed ? null : <ResizeHandle />}
        </aside>
    );
}
