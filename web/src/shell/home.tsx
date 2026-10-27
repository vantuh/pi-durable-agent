import { PanelLeft, Plus, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { MINUTE, SessionRowContent } from "./session-parts.tsx";

type Props = {
    sessions: SessionSummary[];
    onOpen: (id: number) => void;
    onNew: () => void;
    onSessions: () => void;
    onSettings: () => void;
};

/** The rest of the history is the sidebar's, folder by folder. */
const RECENT = 20;

function newestFirst(left: SessionSummary, right: SessionSummary): number {
    return (right.activeAt ?? 0) - (left.activeAt ?? 0);
}

function Row({
    session,
    now,
    onOpen,
}: {
    session: SessionSummary;
    now: number;
    onOpen: (id: number) => void;
}) {
    return (
        <a
            href={sessionHref(session.id)}
            title={session.cwd ?? undefined}
            onClick={(event) => {
                if (isPlainClick(event)) {
                    event.preventDefault();
                    onOpen(session.id);
                }
            }}
            className="rounded-control hover:bg-raised/50 flex items-center gap-3 px-2 py-2"
        >
            <SessionRowContent session={session} now={now} />
        </a>
    );
}

/** Every folder's sessions on one page: what is working, what finished unseen, what was recent. */
export function Home({ sessions, onOpen, onNew, onSessions, onSettings }: Props) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    const listed = sessions.filter((session) => !session.archived).toSorted(newestFirst);
    const groups = [
        { name: "Working", rows: listed.filter((session) => session.busy) },
        { name: "Not viewed", rows: listed.filter((session) => session.unseen) },
        {
            name: "Recent",
            rows: listed.filter((session) => !session.busy && !session.unseen).slice(0, RECENT),
        },
    ];

    return (
        <section className="rounded-card border-edge-soft bg-canvas flex min-h-0 flex-1 flex-col border">
            <header className="border-edge-soft flex items-center justify-between gap-3 border-b px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        title="Sessions"
                        onClick={onSessions}
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 shrink-0 items-center justify-center lg:hidden"
                    >
                        <PanelLeft className="size-4" />
                    </button>
                    <h1 className="text-interface text-ink truncate font-medium">Home</h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onNew}
                        className="rounded-control text-meta text-muted hover:bg-raised hover:text-ink flex items-center gap-1.5 px-2 py-1"
                    >
                        <Plus className="size-3.5" />
                        New session
                    </button>
                    <button
                        type="button"
                        title="Settings"
                        onClick={onSettings}
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
                    >
                        <SettingsIcon className="size-4" />
                    </button>
                </div>
            </header>

            <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">
                    {listed.length === 0 ? (
                        <p className="text-meta text-faint px-2">No sessions yet</p>
                    ) : null}
                    {groups.map((group) =>
                        group.rows.length === 0 ? null : (
                            <div key={group.name}>
                                <h2 className="text-faint text-meta px-2 py-1.5">
                                    {group.name} {group.rows.length}
                                </h2>
                                {group.rows.map((session) => (
                                    <Row
                                        key={session.id}
                                        session={session}
                                        now={now}
                                        onOpen={onOpen}
                                    />
                                ))}
                            </div>
                        ),
                    )}
                </div>
            </ScrollArea>
        </section>
    );
}
