import { Bot } from "lucide-react";
import { useEffect, useState } from "react";

import { isPlainClick, sessionHref } from "@/lib/route.ts";
import { callAction } from "@/sdk/actions.ts";
import type { AboveComposerProps, WebExtension } from "@/sdk/types.ts";

import { type Strip, strip, type StripAgent } from "./refs.ts";

const WARN_ABOVE = 70;

// Agents run in the background, so the parent never changes when one starts, works or ends. The
// server says so through `revision` whenever one of its agents commits.
function useStrip(session: number | null, revision: number): Strip | null {
    const [found, setFound] = useState<{ session: number; strip: Strip } | null>(null);

    useEffect(() => {
        if (session === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            let next: Strip | null = null;

            try {
                next = await callAction(strip, undefined, session);
            } catch {
                next = null;
            }

            if (alive) {
                setFound(next === null ? null : { session, strip: next });
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the revision only says "ask again"
    }, [session, revision]);

    return found !== null && found.session === session ? found.strip : null;
}

function compact(count: number): string {
    return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`;
}

// The provider is in the hover title; the chip has room for the model's own name.
function shortModel(model: string): string {
    return model.slice(model.indexOf("/") + 1);
}

function hover(agent: StripAgent): string {
    const context =
        agent.window > 0
            ? `${compact(agent.used)} / ${compact(agent.window)} (${String(agent.fill)}%)`
            : "none yet";

    return `${[agent.name, agent.profile, agent.model].filter((part) => part !== "").join(" · ")}. Context estimate: ${context}.`;
}

// Both views take the same height, so the composer stays where it is: 36px plus 2px of margin each side.
const ROW = "h-9 max-[760px]:h-10";

function Chip({ agent, href, onOpen }: { agent: StripAgent; href: string; onOpen: () => void }) {
    return (
        <a
            href={href}
            title={hover(agent)}
            aria-label={`Open ${agent.name}'s conversation`}
            onClick={(event) => {
                if (isPlainClick(event)) {
                    event.preventDefault();
                    onOpen();
                }
            }}
            className={`${ROW} border-edge-soft bg-panel hover:border-agent focus-visible:border-agent rounded-control flex shrink-0 items-center gap-2 border px-2 py-1 no-underline`}
        >
            <span className="state-mark working text-warn" aria-hidden />
            <span className="text-ink text-meta max-w-[120px] truncate">{agent.name}</span>
            {agent.model === "" ? null : (
                <span className="text-faint max-w-[84px] truncate text-[10px]">
                    {shortModel(agent.model)}
                </span>
            )}
            <span className="text-faint flex items-center gap-1.5 font-mono text-[11px]">
                {agent.window > 0 ? (
                    <>
                        <span className="bg-raised flex h-1 w-7 overflow-hidden rounded-full">
                            <span
                                className={agent.fill > WARN_ABOVE ? "bg-warn" : "bg-accent"}
                                style={{ width: `${String(agent.fill)}%` }}
                            />
                        </span>
                        {`${String(agent.fill)}%`}
                    </>
                ) : (
                    "—"
                )}
            </span>
        </a>
    );
}

function Agents({ session, openSession }: AboveComposerProps) {
    const id = session?.id ?? null;
    const data = useStrip(id, session?.revision ?? 0);

    if (data?.parent) {
        const { parent } = data;

        return (
            <a
                href={sessionHref(parent.id)}
                onClick={(event) => {
                    if (isPlainClick(event)) {
                        event.preventDefault();
                        openSession(parent.id);
                    }
                }}
                className={`${ROW} text-agent text-sidebar rounded-control border-edge-soft bg-panel mx-1.5 my-0.5 flex shrink-0 items-center truncate border px-3`}
            >
                <span className="truncate">← Back to {parent.title}</span>
            </a>
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

export default {
    tools: ["agent_spawn", "agent_send", "agent_stop", "agent_status"].map((id) => ({
        id,
        icon: Bot,
    })),
    aboveComposer: [{ id: "agents", component: Agents }],
} satisfies WebExtension;
