import { PanelLeft, Settings as SettingsIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";

import { Spinner } from "@/components/ui/spinner";

import type { ClientEntry, ClientLive } from "../../../shared/protocol.ts";
import { type Item, type Turn, turnsOf } from "../lib/turns.ts";
import { ActivityGroup, formatDuration, useNow } from "./activity.tsx";
import { Markdown } from "./markdown.tsx";

type Props = {
    title: string | null;
    entries: ClientEntry[];
    live: ClientLive;
    /** Buttons of the extensions' panels, before the settings gear. */
    tools?: ReactNode;
    onSettings: () => void;
    onSessions: () => void;
};

const tokens = (count: number): string =>
    count < 1000 ? String(count) : `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;

const dollars = (cost: number): string => `$${cost.toFixed(cost < 1 ? 3 : 2)}`;

/**
 * The answer's statistics, above it: model and thinking level, then context, output, cost and time. Context is the
 * newest response's prompt; output and cost add up every response of the turn. Its title says it in full.
 */
function AnswerHeader({ turn }: { turn: Turn }) {
    const now = useNow(turn.live);
    const stats = turn.stats;
    const startedAt = stats?.startedAt ?? turn.user?.at;
    const until = turn.live ? now : stats?.endedAt;
    const time = startedAt === undefined || until === undefined ? undefined : until - startedAt;
    const spend =
        stats === undefined
            ? []
            : [
                  `↑${tokens(stats.context)} ↓${tokens(stats.output)}`,
                  ...(stats.cost > 0 ? [dollars(stats.cost)] : []),
              ];
    const title =
        stats === undefined
            ? undefined
            : [
                  `${String(stats.responses)} ${stats.responses === 1 ? "response" : "responses"}`,
                  `context ${stats.context.toLocaleString()} tokens`,
                  `output ${stats.output.toLocaleString()} tokens`,
                  ...(stats.cost > 0 ? [`cost ${dollars(stats.cost)}`] : []),
              ].join(" · ");

    return (
        <div
            title={title}
            className="text-meta text-faint flex min-w-0 items-center gap-2 font-mono"
        >
            {turn.live ? <Spinner className="size-3 shrink-0" /> : null}
            <span className="text-muted truncate">
                {stats === undefined ? "working" : stats.model}
                {stats?.thinkingLevel === undefined ? "" : ` · ${stats.thinkingLevel}`}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
                {[...spend, ...(time === undefined ? [] : [formatDuration(time)])].join(" · ")}
            </span>
        </div>
    );
}

function TurnItem({ item }: { item: Item }) {
    if (item.type === "activity") {
        return <ActivityGroup item={item} />;
    }

    if (item.type === "error") {
        return <p className="text-meta text-danger">{item.text}</p>;
    }

    return <Markdown text={item.text} streaming={item.streaming} />;
}

function TurnView({ turn }: { turn: Turn }) {
    return (
        <div className="flex flex-col gap-3">
            {turn.user === undefined ? null : (
                <div className="flex justify-end">
                    <p className="rounded-card bg-raised text-prose text-ink max-w-[80%] px-3 py-2 whitespace-pre-wrap">
                        {turn.user.text}
                    </p>
                </div>
            )}
            {turn.items.length === 0 && !turn.live ? null : (
                <div className="flex flex-col gap-2.5">
                    {turn.stats === undefined && !turn.live ? null : <AnswerHeader turn={turn} />}
                    {turn.items.map((item) => (
                        <TurnItem key={item.key} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function Transcript({ title, entries, live, tools, onSettings, onSessions }: Props) {
    const bottom = useRef<HTMLDivElement>(null);
    const turns = useMemo(() => turnsOf(entries, live), [entries, live]);
    const grown = (live.blocks ?? []).reduce(
        (size, block) => size + (block.type === "toolCall" ? 0 : block.text.length),
        0,
    );
    const signature = `${String(entries.length)}:${String(grown)}`;

    useLayoutEffect(() => {
        const target = bottom.current;

        if (target !== null) {
            target.scrollIntoView({ block: "end" });
        }
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- entries and streamed text are the trigger: follow the answer as it grows
    }, [signature]);

    return (
        <section className="rounded-card border-edge-soft bg-canvas rounded-card flex min-h-0 flex-1 flex-col border">
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
                    <h1 className="text-interface text-ink truncate font-medium">
                        {title ?? "New session"}
                    </h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {tools}
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

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="mx-auto flex max-w-[46rem] flex-col gap-4">
                    {turns.map((turn) => (
                        <TurnView key={turn.key} turn={turn} />
                    ))}

                    {entries.length === 0 && live.blocks === undefined ? (
                        <p className="text-prose text-faint">Nothing here yet. Ask something.</p>
                    ) : null}

                    <div ref={bottom} />
                </div>
            </div>
        </section>
    );
}
