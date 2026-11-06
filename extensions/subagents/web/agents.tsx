import { Item } from "@/components/ui/item.tsx";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import type { AboveComposerProps } from "@/sdk/types.ts";

import { Chip } from "./chip.tsx";
import { ROW } from "./strip-row.ts";
import { useStrip } from "./use-strip.ts";

export function Agents({ session, openSession }: AboveComposerProps) {
    const id = session?.id ?? null;
    const data = useStrip(id, session?.revision ?? 0);

    if (data?.parent) {
        const { parent } = data;

        return (
            <Item
                asChild
                className={`${ROW} text-agent text-ui border-edge-soft bg-panel mx-1.5 my-0.5 shrink-0 truncate border px-3`}
            >
                <a
                    href={sessionHref(parent.id)}
                    onClick={(event) => {
                        if (isPlainClick(event)) {
                            event.preventDefault();
                            openSession(parent.id);
                        }
                    }}
                >
                    <span className="truncate">← Back to {parent.title}</span>
                </a>
            </Item>
        );
    }

    if (data === null || data.agents.length === 0) {
        return null;
    }

    return (
        <section aria-label="Working agents" className="shrink-0 px-1">
            <ul className="flex [scrollbar-width:thin] gap-2 overflow-x-auto overflow-y-hidden p-0.5">
                {data.agents.map((agent) => (
                    <li key={agent.session} className="flex shrink-0">
                        <Chip
                            agent={agent}
                            href={sessionHref(agent.session)}
                            folder={session?.cwd ?? null}
                            onOpen={() => {
                                openSession(agent.session);
                            }}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}
