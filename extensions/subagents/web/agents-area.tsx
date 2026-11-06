import { useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import type { SidebarBottomProps } from "@/sdk/types.ts";

import { AgentRow } from "./agent-row.tsx";
import { agentsOf, areaParent } from "./area.ts";
import { useMinute } from "./use-minute.ts";
import { useNames } from "./use-names.ts";

// Every agent of the open session, or of the session that started the open one. Nothing while there is none.
export function AgentsArea({ session, sessions, openSession }: SidebarBottomProps) {
    const open = session?.id ?? null;
    const parent = areaParent(open, sessions);
    const kids = parent === undefined ? [] : agentsOf(parent.id, sessions);
    const names = useNames(parent?.id ?? null, kids);
    const now = useMinute();
    const list = useRef<HTMLDivElement>(null);

    const shown = kids.length > 0;

    useEffect(() => {
        if (shown) {
            list.current
                ?.querySelector(`[data-session="${String(open)}"]`)
                ?.scrollIntoView({ block: "nearest" });
        }
    }, [open, shown]);

    if (parent === undefined || !shown) {
        return null;
    }

    return (
        <section aria-label="Subagents" className="flex min-h-0 flex-1 flex-col">
            <h2 className="text-meta text-faint flex h-7 shrink-0 items-center gap-2 px-3 font-normal">
                <span className="min-w-0 flex-1 truncate">Subagents</span>
                <span className="font-mono">{kids.length}</span>
            </h2>
            <ScrollArea ref={list} className="min-h-0 flex-1">
                <ul className="m-0 list-none px-1.5 pb-1">
                    {kids.map((kid) => (
                        <AgentRow
                            key={kid.id}
                            kid={kid}
                            name={names.get(kid.id)?.name ?? kid.title ?? "Agent"}
                            profile={names.get(kid.id)?.profile}
                            current={kid.id === open}
                            now={now}
                            openSession={openSession}
                        />
                    ))}
                </ul>
            </ScrollArea>
        </section>
    );
}
