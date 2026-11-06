import { Item, ItemTitle } from "@/components/ui/item.tsx";
import { isPlainClick, sessionHref } from "@/lib/route.ts";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedAgo } from "./area.ts";

export function AgentRow({
    kid,
    name,
    profile,
    current,
    now,
    openSession,
}: {
    kid: SessionSummary;
    name: string;
    profile: string | undefined;
    current: boolean;
    now: number;
    openSession: (id: number) => void;
}) {
    const status = kid.busy ? "working" : finishedAgo(kid.endedAt, now);

    return (
        <li>
            <Item
                asChild
                className={`h-8 px-2 no-underline max-lg:h-11 ${current ? "bg-raised" : "hover:bg-raised/50"}`}
            >
                <a
                    href={sessionHref(kid.id)}
                    data-session={kid.id}
                    title={[name, profile, status].filter((part) => part !== undefined).join(" · ")}
                    aria-current={current ? "page" : undefined}
                    onClick={(event) => {
                        if (isPlainClick(event)) {
                            event.preventDefault();
                            openSession(kid.id);
                        }
                    }}
                >
                    <span
                        className={`state-mark ${kid.busy ? "working text-warn" : kid.unseen ? "fresh text-ok" : "idle text-faint"}`}
                        aria-hidden
                    />
                    <ItemTitle className={`min-w-0 flex-1 ${kid.busy ? "text-ink" : "text-muted"}`}>
                        {name}
                    </ItemTitle>
                    <span
                        className={`text-meta shrink-0 whitespace-nowrap ${kid.busy ? "text-muted" : "text-faint"}`}
                    >
                        {status}
                    </span>
                </a>
            </Item>
        </li>
    );
}
