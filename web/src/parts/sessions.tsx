import {
    Archive,
    ArchiveRestore,
    ArrowLeft,
    ChevronDown,
    Folder,
    MoreHorizontal,
    Pencil,
    Plus,
    X,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { toast } from "../lib/toast.ts";

type Props = {
    sessions: SessionSummary[];
    current: number | null;
    onArchive: (id: number, archived: boolean) => Promise<void>;
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Elapsed time as one short unit: "now", "5m", "2h", "3d"; a date past a week. */
function ago(at: number, now: number): string {
    const elapsed = Math.max(0, now - at);

    if (elapsed < MINUTE) {
        return "now";
    }

    if (elapsed < HOUR) {
        return `${String(Math.floor(elapsed / MINUTE))}m`;
    }

    if (elapsed < DAY) {
        return `${String(Math.floor(elapsed / HOUR))}h`;
    }

    if (elapsed < 7 * DAY) {
        return `${String(Math.floor(elapsed / DAY))}d`;
    }

    return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

function folderName(cwd: string | null): string {
    if (cwd === null || cwd === "") {
        return "no folder";
    }

    const parts = cwd.split("/");

    return parts[parts.length - 1] ?? cwd;
}

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
    onSelect,
    onArchive,
    onRename,
    onFolder,
    onNew,
    open: sheet,
    onClose,
}: Props) {
    const active = sessions.find((session) => session.id === current);
    const [open, setOpen] = useState(false);
    const [archived, setArchived] = useState(false);
    const [pending, setPending] = useState(false);
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
                            loading: "Undoing…",
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
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        setWidth(savedWidth(), false);
    }, []);

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    const folder = active?.cwd ?? null;
    const folders = new Map<string, number>();

    for (const session of sessions) {
        if (session.cwd !== null) {
            folders.set(session.cwd, (folders.get(session.cwd) ?? 0) + 1);
        }
    }

    const latest = (cwd: string | null): SessionSummary[] =>
        sessions
            .filter((session) => session.cwd === cwd)
            .toSorted((left, right) => (right.activeAt ?? 0) - (left.activeAt ?? 0));

    const shown = latest(folder).filter((session) => session.archived === archived);

    return (
        <aside
            className={`rounded-card border-edge-soft bg-canvas shrink-0 flex-col border lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-[min(var(--sidebar-w,264px),max(264px,40vw))] ${
                sheet ? "fixed inset-2 z-30 flex" : "hidden"
            }`}
        >
            <header className="border-edge-soft flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <h2 className="text-sidebar text-ink font-medium">Sessions</h2>
                <div className="flex items-center gap-1">
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

            <div className="border-edge-soft relative border-b">
                <button
                    type="button"
                    onClick={() => {
                        setOpen(!open);
                    }}
                    className="hover:bg-raised flex w-full items-center gap-1.5 px-3 py-2"
                >
                    <Folder className="text-faint size-3 shrink-0" />
                    <span className="text-meta text-muted min-w-0 flex-1 truncate text-left font-mono">
                        {folderName(folder)}
                    </span>
                    <ChevronDown className="text-faint size-3.5 shrink-0" />
                </button>

                {open ? (
                    <div className="rounded-card border-edge-soft bg-panel absolute inset-x-1.5 top-full z-10 mt-1 border shadow-lg">
                        <ScrollArea viewportProps={{ className: "max-h-72 p-1" }}>
                            {[...folders].map(([cwd, count]) => (
                                <button
                                    key={cwd}
                                    type="button"
                                    title={cwd}
                                    onClick={() => {
                                        const [first] = latest(cwd);

                                        if (first !== undefined) {
                                            onFolder(first.id);
                                        }

                                        setOpen(false);
                                    }}
                                    className={`rounded-control flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                                        cwd === folder ? "bg-raised" : "hover:bg-raised/50"
                                    }`}
                                >
                                    <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                                        {folderName(cwd)}
                                    </span>
                                    <span className="text-faint text-meta">{count}</span>
                                </button>
                            ))}
                        </ScrollArea>
                    </div>
                ) : null}
            </div>

            <div className="px-3 pt-3">
                <button
                    type="button"
                    onClick={onNew}
                    className="rounded-control border-edge bg-sunken text-ink hover:bg-raised flex w-full items-center justify-center gap-2 border py-2.5"
                >
                    <Plus className="size-4" />
                    <span className="text-sidebar">New session</span>
                </button>
            </div>

            <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-meta text-muted">{archived ? "Archive" : "Sessions"}</span>
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
                    {archived ? <ArrowLeft className="size-4" /> : <Archive className="size-4" />}
                </button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <nav className="p-1.5">
                    {shown.length === 0 ? (
                        <p className="text-meta text-faint px-2 py-3">
                            {archived ? "No archived sessions" : "No sessions"}
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
                                <div className="text-faint text-meta px-2 py-1.5">
                                    {group} {rows.length}
                                </div>

                                {rows.map((session) => (
                                    <div
                                        key={session.id}
                                        className={`session-row group rounded-control relative flex items-center ${session.id === current ? "bg-raised" : "hover:bg-raised/50"}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onSelect(session.id);
                                            }}
                                            className="rounded-control flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                                        >
                                            <span
                                                role={session.busy ? "status" : undefined}
                                                aria-label={session.busy ? "Working" : undefined}
                                                className={`state-mark ${session.busy ? "working text-accent" : "idle text-faint"}`}
                                            />
                                            <span className="text-sidebar text-ink min-w-0 flex-1 truncate">
                                                {session.title ?? "New session"}
                                            </span>
                                            <span className="session-time text-faint text-meta min-w-7 shrink-0 text-right">
                                                {session.activeAt === null
                                                    ? null
                                                    : ago(session.activeAt, now)}
                                            </span>
                                        </button>
                                        <DropdownMenu modal={false}>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    aria-label={`Actions for ${session.title ?? "New session"}`}
                                                    title="Session actions"
                                                    className="session-actions rounded-control text-muted hover:bg-panel hover:text-ink absolute right-1 flex size-7 items-center justify-center"
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
                                                <DropdownMenuItem
                                                    onSelect={() => {
                                                        setRenaming({
                                                            id: session.id,
                                                            name: session.title ?? "",
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
                                                    {session.archived ? "Restore" : "Archive"}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </nav>
            </ScrollArea>

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

            <ResizeHandle />
        </aside>
    );
}
