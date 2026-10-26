import { ChevronDown, Folder, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";

type Props = {
    sessions: SessionSummary[];
    current: number | null;
    onSelect: (id: number) => void;
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

export function Sessions({ sessions, current, onSelect, onNew, open: sheet, onClose }: Props) {
    const active = sessions.find((session) => session.id === current);
    const [picked, setPicked] = useState<string | null>(null);
    const [seen, setSeen] = useState(active?.cwd ?? null);
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    if ((active?.cwd ?? null) !== seen) {
        setSeen(active?.cwd ?? null);
        setPicked(null);
    }

    const folder = picked ?? active?.cwd ?? null;
    const folders = new Map<string, number>();

    for (const session of sessions) {
        if (session.cwd !== null) {
            folders.set(session.cwd, (folders.get(session.cwd) ?? 0) + 1);
        }
    }

    const shown = sessions
        .filter((session) => session.cwd === folder)
        .toSorted((left, right) => (right.activeAt ?? 0) - (left.activeAt ?? 0));

    return (
        <aside
            className={`rounded-card border-edge-soft bg-canvas shrink-0 flex-col border lg:static lg:inset-auto lg:z-auto lg:flex lg:w-[264px] ${
                sheet ? "fixed inset-2 z-30 flex" : "hidden"
            }`}
        >
            <header className="border-edge-soft flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">Sessions</h2>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onNew}
                        title="New session"
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
                    >
                        <Plus className="size-4" />
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
                    <div className="rounded-card border-edge-soft bg-panel absolute inset-x-1.5 top-full z-10 mt-1 max-h-72 overflow-y-auto border p-1 shadow-lg">
                        {[...folders].map(([cwd, count]) => (
                            <button
                                key={cwd}
                                type="button"
                                title={cwd}
                                onClick={() => {
                                    setPicked(cwd);
                                    setOpen(false);
                                }}
                                className={`rounded-control flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                                    cwd === folder ? "bg-raised" : "hover:bg-raised"
                                }`}
                            >
                                <span className="text-meta text-ink min-w-0 flex-1 truncate font-mono">
                                    {folderName(cwd)}
                                </span>
                                <span className="text-faint text-meta">{count}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
                                <button
                                    key={session.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(session.id);
                                    }}
                                    className={`rounded-control flex w-full items-center gap-2 px-2 py-2 text-left ${
                                        session.id === current ? "bg-raised" : "hover:bg-raised"
                                    }`}
                                >
                                    <span
                                        className={`size-2 shrink-0 rounded-full ${session.busy ? "bg-warn" : "bg-faint"}`}
                                    />
                                    <span className="text-interface text-ink min-w-0 flex-1 truncate">
                                        {session.title ?? "New session"}
                                    </span>
                                    {session.activeAt === null ? null : (
                                        <span className="text-faint text-meta shrink-0">
                                            {ago(session.activeAt, now)}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </nav>
        </aside>
    );
}
