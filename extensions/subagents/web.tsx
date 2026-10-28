import { Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import { callAction } from "@/sdk/actions.ts";
import type {
    AboveComposerProps,
    SidebarBottomProps,
    StatusItemProps,
    StatusRowProps,
    WebExtension,
} from "@/sdk/types.ts";

import type { SessionSummary } from "../../shared/protocol.ts";
import { agentsOf, areaParent, finishedAgo, hasWorkingAgent, workingAgentCount } from "./area.ts";
import { agents, type NamedAgent, type Strip, strip, type StripAgent } from "./refs.ts";

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

// The records change only when an agent is added; the key also moves when one finishes, which
// heals a list that arrived before the record did.
function useNames(parent: number | null, kids: readonly SessionSummary[]): Map<number, NamedAgent> {
    const [found, setFound] = useState<{ parent: number; named: NamedAgent[] } | null>(null);
    const key = kids.map((kid) => `${String(kid.id)}${kid.busy ? "+" : "-"}`).join();

    useEffect(() => {
        if (parent === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            try {
                const named = await callAction(agents, undefined, parent);

                if (alive) {
                    setFound({ parent, named });
                }
            } catch {
                // The titles stand in for the names.
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the key stands for the children
    }, [parent, key]);

    return new Map(
        (found !== null && found.parent === parent ? found.named : []).map((named) => [
            named.session,
            named,
        ]),
    );
}

// The times in the rows are read off this, so they move on while nothing else does.
function useMinute(): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, 60_000);

        return () => {
            clearInterval(tick);
        };
    }, []);

    return now;
}

function AgentRow({
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
                className={`rounded-control flex h-8 items-center gap-2 px-2 no-underline max-lg:h-11 ${current ? "bg-raised" : "hover:bg-raised/50"}`}
            >
                <span
                    className={`state-mark ${kid.busy ? "working text-warn" : kid.unseen ? "fresh text-ok" : "idle text-faint"}`}
                    aria-hidden
                />
                <span
                    className={`text-sidebar min-w-0 flex-1 truncate ${kid.busy ? "text-ink" : "text-muted"}`}
                >
                    {name}
                </span>
                <span
                    className={`text-meta shrink-0 whitespace-nowrap ${kid.busy ? "text-muted" : "text-faint"}`}
                >
                    {status}
                </span>
            </a>
        </li>
    );
}

// Every agent of the open session, or of the session that started the open one. Nothing while there is none.
function AgentsArea({ session, sessions, openSession }: SidebarBottomProps) {
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

    const title = parent.title ?? "New session";

    return (
        <section aria-label={`Agents of ${title}`} className="flex min-h-0 flex-1 flex-col">
            <h2 className="text-meta text-faint flex h-7 shrink-0 items-center gap-2 px-3 font-normal">
                <span className="min-w-0 flex-1 truncate">
                    Agents of <b className="text-muted font-medium">{title}</b>
                </span>
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

// After the session counts, as in the approved mockup. The open agent is not counted.
function AgentsWorking({ session, sessions }: StatusItemProps) {
    const count = workingAgentCount(sessions, session?.id ?? null);

    if (count === 0) {
        return null;
    }

    return (
        <span className="text-warn shrink-0">
            · {count} {count === 1 ? "agent" : "agents"} working
        </span>
    );
}

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

    return (
        <>
            <p className="text-meta text-faint flex items-center gap-2 px-2 py-1">
                <span className="min-w-0 flex-1 truncate">
                    <b className="text-muted font-medium">{parent.title ?? "New session"}</b>
                </span>
                <span className="shrink-0">{kids.length} working</span>
            </p>
            {kids.map((kid) => {
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
                            <span className="text-sidebar text-ink min-w-0 flex-1 truncate">
                                {name}
                            </span>
                        </a>
                    </DropdownMenuItem>
                );
            })}
        </>
    );
}

// Inside the row's link, so it is only a mark and a count: the core makes the whole row the trigger.
function AgentsMarker({ session, sessions }: StatusRowProps) {
    const count = agentsOf(session.id, sessions).filter((kid) => kid.busy).length;

    return (
        <span className="text-meta text-muted flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="state-mark working text-warn" aria-hidden />
            <span aria-hidden>{count}</span>
            <span className="sr-only">
                {count} {count === 1 ? "agent" : "agents"} working
            </span>
        </span>
    );
}

function AgentsSubmenu({ session, sessions, openSession }: StatusRowProps) {
    const kids = agentsOf(session.id, sessions).filter((kid) => kid.busy);

    return <WorkingAgents parent={session} kids={kids} openSession={openSession} />;
}

export default {
    tools: ["agent_spawn", "agent_send", "agent_stop", "agent_status"].map((id) => ({
        id,
        icon: Bot,
    })),
    aboveComposer: [{ id: "agents", component: Agents }],
    sidebarBottom: [{ id: "agents", component: AgentsArea }],
    status: [{ id: "agents-working", slot: "start", component: AgentsWorking }],
    statusRow: [
        { id: "agents", has: hasWorkingAgent, component: AgentsMarker, submenu: AgentsSubmenu },
    ],
} satisfies WebExtension;
