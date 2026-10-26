import { ChevronDown, Folder, Plus } from "lucide-react";
import { useState } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";

type Props = {
    sessions: SessionSummary[];
    current: number | null;
    onSelect: (id: number) => void;
    onNew: () => void;
};

function folderName(cwd: string | null): string {
    if (cwd === null || cwd === "") {
        return "no folder";
    }

    const parts = cwd.split("/");

    return parts[parts.length - 1] ?? cwd;
}

export function Sessions({ sessions, current, onSelect, onNew }: Props) {
    const active = sessions.find((session) => session.id === current);
    const [picked, setPicked] = useState<string | null>(null);
    const [seen, setSeen] = useState(active?.cwd ?? null);
    const [open, setOpen] = useState(false);

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

    const shown = sessions.filter((session) => session.cwd === folder);

    return (
        <aside className="rounded-card border-edge-soft bg-canvas hidden w-[264px] shrink-0 flex-col border lg:flex">
            <header className="border-edge-soft flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">Sessions</h2>
                <button
                    type="button"
                    onClick={onNew}
                    title="New session"
                    className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
                >
                    <Plus className="size-4" />
                </button>
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
                <div className="text-faint text-meta px-2 py-1.5">Sessions {shown.length}</div>

                {shown.map((session) => (
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
                    </button>
                ))}
            </nav>
        </aside>
    );
}
