import { DropdownMenuItem } from "@/components/ui/dropdown-menu.tsx";
import { ItemTitle } from "@/components/ui/item.tsx";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import type { StatusRowProps } from "@/sdk/types.ts";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { agentsOf } from "./area.ts";
import { useNames } from "./use-names.ts";

// Mounted only while the submenu is open, so the names are asked for when somebody looks.
function WorkingAgents({
    parent,
    kids,
    openSession,
}: {
    parent: SessionSummary;
    kids: SessionSummary[];
    openSession: (id: number) => void;
}) {
    const names = useNames(parent.id, kids);

    return kids.map((kid) => {
        const name = names.get(kid.id)?.name ?? kid.title ?? "Agent";

        return (
            <DropdownMenuItem key={kid.id} asChild className="gap-2 px-2 py-1.5">
                <a
                    href={sessionHref(kid.id)}
                    onClick={(event) => {
                        // A modified click is the browser's: a new tab, and the menu stays.
                        if (isPlainClick(event)) {
                            event.preventDefault();
                            openSession(kid.id);
                        }
                    }}
                >
                    <span className="state-mark working text-warn" aria-hidden />
                    <ItemTitle className="min-w-0 flex-1">{name}</ItemTitle>
                </a>
            </DropdownMenuItem>
        );
    });
}

export function AgentsSubmenu({ session, sessions, openSession }: StatusRowProps) {
    const kids = agentsOf(session.id, sessions).filter((kid) => kid.busy);

    return <WorkingAgents parent={session} kids={kids} openSession={openSession} />;
}
