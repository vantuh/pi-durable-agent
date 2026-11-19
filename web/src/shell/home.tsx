import { PanelLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, REACH } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { useHomeItems } from "../extensions.ts";
import { isPlainClick, sessionHref } from "../lib/route.ts";
import { folderSession } from "../lib/session-folders.ts";
import { sidebarSessions, workingChildren } from "../lib/session-nesting.ts";
import { newestFirst } from "../lib/session-order.ts";
import { MINUTE } from "../lib/time.ts";
import { GroupHeading } from "../ui/group-heading.tsx";
import { ItemBoundary } from "../ui/item-boundary.tsx";
import { PaneHeader } from "../ui/pane.tsx";
import { SessionMarks, SessionRowContent } from "./session-parts.tsx";

type Props = {
    sessions: SessionSummary[];
    onOpen: (id: number) => void;
    onNew: () => void;
    onSessions: () => void;
    /** Opens an extension's page (its key, `folder:id`) in a session, for a home group's row. */
    onOpenPage: (session: number, key: string, sub?: string) => void;
};

/** The rest of the history is the sidebar's, folder by folder. */
const RECENT = 20;

function Row({
    session,
    now,
    working,
    onOpen,
}: {
    session: SessionSummary;
    now: number;
    working: number;
    onOpen: (id: number) => void;
}) {
    return (
        <Item asChild className="hover:bg-raised/50">
            <a
                href={sessionHref(session.id)}
                title={session.cwd ?? undefined}
                onClick={(event) => {
                    if (isPlainClick(event)) {
                        event.preventDefault();
                        onOpen(session.id);
                    }
                }}
            >
                <SessionRowContent
                    session={session}
                    now={now}
                    working={working}
                    trailing={<SessionMarks session={session} />}
                />
            </a>
        </Item>
    );
}

/** Every folder's sessions on one page: what is working, what finished unseen, what was recent. */
export function Home({ sessions, onOpen, onNew, onSessions, onOpenPage }: Props) {
    const [now, setNow] = useState(() => Date.now());
    const items = useHomeItems();

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);

        return () => {
            clearInterval(tick);
        };
    }, []);

    const listed = sidebarSessions(sessions)
        .filter((session) => !session.archived)
        .toSorted(newestFirst);
    const groups = [
        { name: "Working", rows: listed.filter((session) => session.busy) },
        { name: "Not viewed", rows: listed.filter((session) => session.unseen) },
        {
            name: "Recent",
            rows: listed.filter((session) => !session.busy && !session.unseen).slice(0, RECENT),
        },
    ];

    return (
        <section className="bg-canvas flex min-h-0 flex-1 flex-col">
            <PaneHeader className="gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Hint label="Sessions">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Sessions"
                            onClick={onSessions}
                            className={`shrink-0 lg:hidden ${REACH}`}
                        >
                            <PanelLeft className="size-4" />
                        </Button>
                    </Hint>
                    <h1 className="text-interface text-ink truncate font-medium">Home</h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={onNew}>
                        <Plus className="size-3.5" />
                        New session
                    </Button>
                </div>
            </PaneHeader>

            <ScrollArea className="min-h-0 flex-1">
                {/* The extensions' column sits beside the sessions on a wide screen and under them on a narrow one;
                    with nothing in it, it takes no room and the sessions stay centred. */}
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 lg:flex-row lg:items-start lg:justify-center lg:gap-6">
                    <div className="flex min-w-0 flex-col gap-4 lg:max-w-3xl lg:flex-1">
                        {listed.length === 0 ? (
                            <Empty className="px-2">No sessions yet</Empty>
                        ) : null}
                        {groups.map((group) =>
                            group.rows.length === 0 ? null : (
                                <div key={group.name}>
                                    <GroupHeading>
                                        {group.name} {group.rows.length}
                                    </GroupHeading>
                                    {group.rows.map((session) => (
                                        <Row
                                            key={session.id}
                                            session={session}
                                            now={now}
                                            working={workingChildren(session.id, sessions)}
                                            onOpen={onOpen}
                                        />
                                    ))}
                                </div>
                            ),
                        )}
                    </div>
                    <div className="flex flex-col gap-4 empty:hidden lg:w-80 lg:shrink-0">
                        {items.map(({ folder, id, component: Group }) => (
                            <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                                <Group
                                    openPage={(cwd, page, sub) => {
                                        const target = folderSession(sessions, null, cwd);

                                        if (target !== undefined) {
                                            onOpenPage(target.id, `${folder}:${page}`, sub);
                                        }
                                    }}
                                />
                            </ItemBoundary>
                        ))}
                    </div>
                </div>
            </ScrollArea>
        </section>
    );
}
