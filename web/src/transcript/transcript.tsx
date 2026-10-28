import {
    ChevronRight,
    CircleAlert,
    Layers,
    PanelLeft,
    Settings as SettingsIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";

import type { ClientEntry, ClientLive } from "../../../shared/protocol.ts";
import { readProviderError } from "../lib/provider-error.ts";
import { type Item, type Turn, turnsOf } from "../lib/turns.ts";
import { cn } from "../lib/utils.ts";
import { Attachments } from "../ui/attachments.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { ActivityGroup, formatDuration, useNow } from "./activity.tsx";
import { AgentMessage } from "./agent-message.tsx";

type Props = {
    title: string | null;
    entries: ClientEntry[];
    live: ClientLive;
    /** Buttons of the extensions' panels, before the settings gear. */
    tools?: ReactNode;
    onSettings: () => void;
    onSessions: () => void;
    /** Goes to another conversation, the one an agent's message came from. */
    onOpenSession: (session: number) => void;
    /** A small line under the title: the branch, as extensions add it. */
    below: ReactNode;
    /** Asks the server for the page older than what is on screen. */
    onLoadOlder: () => Promise<void>;
    loadingOlder: boolean;
    /** The conversation's first entry is on screen: scrolling up asks for nothing more. */
    exhausted: boolean;
};

/** How close to the top the reader is when the older page is asked for. */
const OLDER_AT = 240;

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
    // Nothing cached is the common case for a first answer; the marker is worth the room only when it says something.
    const cachedPercent =
        stats === undefined || stats.context <= 0 || stats.cached <= 0
            ? undefined
            : Math.round((stats.cached / stats.context) * 100);
    const spend =
        stats === undefined
            ? []
            : [
                  ...(cachedPercent === undefined ? [] : [`↻${String(cachedPercent)}%`]),
                  `↑${tokens(stats.context)} ↓${tokens(stats.output)}`,
                  ...(stats.cost > 0 ? [dollars(stats.cost)] : []),
              ];
    const title =
        stats === undefined
            ? undefined
            : [
                  `${String(stats.responses)} ${stats.responses === 1 ? "response" : "responses"}`,
                  `context ${stats.context.toLocaleString()} tokens`,
                  ...(cachedPercent === undefined
                      ? []
                      : [
                            `${String(cachedPercent)}% of it came from the cache (${stats.cached.toLocaleString()} tokens)`,
                        ]),
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

function ErrorNotice({ text }: { text: string }) {
    const { title, detail, requestId } = readProviderError(text);

    return (
        <div className="bg-danger/10 text-meta flex items-start gap-2 rounded-lg px-3 py-2">
            <CircleAlert className="text-danger mt-0.5 size-3.5 shrink-0" />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-danger break-words">{title}</span>
                {detail === undefined && requestId === undefined ? null : (
                    <span className="text-faint font-mono break-all">
                        {[detail, requestId].filter((part) => part !== undefined).join(" · ")}
                    </span>
                )}
            </div>
        </div>
    );
}

const Rule = () => <span aria-hidden="true" className="bg-edge-soft h-px flex-1" />;

/** The mark's pill, in the tone of what it says: a chip on the line between messages. */
const PILL_TONES = {
    raised: "border-edge bg-raised text-ink",
    warn: "border-warn/30 bg-warn/10 text-warn",
    danger: "border-danger/30 bg-danger/10 text-danger",
} as const;

function CompactionPill({
    children,
    tone = "raised",
    interactive,
}: {
    children: ReactNode;
    tone?: keyof typeof PILL_TONES;
    interactive?: boolean;
}) {
    return (
        <span
            className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1",
                PILL_TONES[tone],
                interactive === true && "hover:border-muted",
            )}
        >
            {children}
        </span>
    );
}

/** A compaction that is running now, at the end of the transcript: where its marker lands once it is done. */
function CompactingMark({ retrying }: { retrying: boolean }) {
    return (
        <div className="flex items-center gap-3">
            <Rule />
            <CompactionPill tone={retrying ? "warn" : "raised"}>
                <Layers className="size-3.5 shrink-0" />
                <span className="text-meta">
                    {retrying ? "compaction failed, retrying" : "compacting earlier messages"}
                </span>
                <Spinner className="size-3 shrink-0" />
            </CompactionPill>
            <Rule />
        </div>
    );
}

/** A compaction that gave up: what came before is still what the model is sent, and the reason is worth reading. */
function CompactionFailedMark({ error }: { error: string }) {
    return (
        <Collapsible className="group/failed flex flex-col gap-2">
            <CollapsibleTrigger className="flex items-center gap-3 text-left">
                <Rule />
                <CompactionPill tone="danger">
                    <CircleAlert className="size-3.5 shrink-0" />
                    <span className="text-meta">compaction failed</span>
                    <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/failed:rotate-90" />
                </CompactionPill>
                <Rule />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <p className="text-meta text-danger text-center break-words">{error}</p>
            </CollapsibleContent>
        </Collapsible>
    );
}

/**
 * Where a compaction cut the context: a line, and the summary the model was handed instead of everything above it.
 * The messages above stay on screen — they are the conversation, they are just no longer what is sent.
 */
function CompactionMark({ summary }: { summary?: string }) {
    const label = <span className="text-meta text-ink">earlier messages were compacted</span>;
    const pill = (
        <CompactionPill interactive={summary !== undefined}>
            <Layers className="size-3.5 shrink-0" />
            {label}
            {summary === undefined ? null : (
                <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/fold:rotate-90" />
            )}
        </CompactionPill>
    );

    if (summary === undefined) {
        return (
            <div className="flex items-center gap-3">
                <Rule />
                {pill}
                <Rule />
            </div>
        );
    }

    return (
        <Collapsible className="group/fold flex flex-col gap-2">
            <CollapsibleTrigger className="flex items-center gap-3 text-left">
                <Rule />
                {pill}
                <Rule />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="rounded-card border-edge-soft bg-panel border px-3 py-2.5">
                    <Markdown text={summary} />
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function TurnItem({ item }: { item: Item }) {
    if (item.type === "activity") {
        return <ActivityGroup item={item} />;
    }

    if (item.type === "error") {
        return <ErrorNotice text={item.text} />;
    }

    return <Markdown text={item.text} streaming={item.streaming} />;
}

function TurnView({
    turn,
    onOpenSession,
}: {
    turn: Turn;
    onOpenSession: (session: number) => void;
}) {
    return (
        <div className="flex flex-col gap-3">
            {turn.compacted === undefined ? null : <CompactionMark {...turn.compacted} />}
            {turn.user?.author === undefined ? null : (
                <AgentMessage
                    text={turn.user.text}
                    author={turn.user.author}
                    onOpenSession={onOpenSession}
                />
            )}
            {turn.user === undefined || turn.user.author !== undefined ? null : (
                <div className="flex justify-end">
                    <div className="rounded-card bg-raised text-prose text-ink max-w-[80%] px-3 py-2">
                        <Attachments
                            files={(turn.user.files ?? []).map((file, index) => ({
                                ...file,
                                key: String(index),
                                state: "done",
                            }))}
                        />
                        {turn.user.text === "" ? null : (
                            <p className="whitespace-pre-wrap">{turn.user.text}</p>
                        )}
                    </div>
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

export function Transcript({
    title,
    entries,
    live,
    tools,
    onSettings,
    onSessions,
    onOpenSession,
    below,
    onLoadOlder,
    loadingOlder,
    exhausted,
}: Props) {
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const lastTop = useRef(0);
    /** The height and position before the last commit: a page added in front must not move what is read. */
    const measured = useRef<{ first: number | undefined; height: number; top: number } | null>(
        null,
    );
    const turns = useMemo(() => turnsOf(entries, live), [entries, live]);
    const newest = entries.at(-1);
    // Only the person's own message pulls the reader down; an agent's report waits where it lands.
    const sent = newest?.kind === "user" && newest.author === undefined;
    const counted = useRef(entries.length);
    const first = entries[0]?.id;

    useLayoutEffect(() => {
        const target = scroller.current;
        const previous = measured.current;

        // A message just sent: go down to it from wherever the reader was.
        if (sent && entries.length > counted.current) {
            following.current = true;
        }

        counted.current = entries.length;

        if (target === null) {
            return;
        }

        const height = target.scrollHeight;
        const top = target.scrollTop;
        const prepended =
            previous !== null && previous.first !== undefined && previous.first !== first;

        measured.current = { first, height, top };

        if (prepended) {
            // An older page arrived above: keep the words the reader was looking at where they were.
            target.scrollTop = height - previous.height + previous.top;
        } else if (following.current) {
            target.scrollTop = target.scrollHeight;
        }
    });

    // Rows that grow between renders (code highlighting, images) keep the bottom in view while following.
    useEffect(() => {
        const target = scroller.current;
        const inner = content.current;

        if (target === null || inner === null) {
            return undefined;
        }

        const sizes = new ResizeObserver(() => {
            if (following.current) {
                target.scrollTop = target.scrollHeight;
            }
        });

        sizes.observe(inner);

        return () => {
            sizes.disconnect();
        };
    }, []);

    return (
        <section className="rounded-card border-edge-soft bg-canvas rounded-card flex min-h-0 flex-1 flex-col border">
            <header className="border-edge-soft flex min-h-[45px] items-center justify-between gap-3 border-b px-3 py-0.5">
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <button
                        type="button"
                        title="Sessions"
                        onClick={onSessions}
                        className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 shrink-0 items-center justify-center lg:hidden"
                    >
                        <PanelLeft className="size-4" />
                    </button>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h1 className="text-interface text-ink truncate leading-5 font-medium">
                            {title ?? "New session"}
                        </h1>
                        <div className="flex min-w-0 items-center gap-2 empty:hidden">{below}</div>
                    </div>
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

            <ScrollArea
                className="min-h-0 flex-1"
                viewportRef={scroller}
                viewportProps={{
                    className: "px-4 py-4",
                    // Leaving is decided by what the reader does, not by where the scroll lands: a chunk of
                    // text arriving before the scroll event must not pull them back down.
                    onWheel: (event) => {
                        if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) {
                            following.current = false;
                        }
                    },
                    onTouchMove: () => {
                        following.current = false;
                    },
                    onPointerDown: (event) => {
                        if (event.target === event.currentTarget) {
                            following.current = false;
                        }
                    },
                    onScroll: (event) => {
                        const el = event.currentTarget;
                        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;

                        // Any move up is the reader leaving; only getting back to the bottom follows again.
                        if (el.scrollTop < lastTop.current) {
                            following.current = false;
                        } else if (gap < 24) {
                            following.current = true;
                        }

                        lastTop.current = el.scrollTop;

                        if (el.scrollTop < OLDER_AT && !exhausted) {
                            void onLoadOlder();
                        }
                    },
                }}
            >
                <div
                    ref={content}
                    className="mx-auto flex max-w-[var(--chat-width)] flex-col gap-4"
                >
                    {loadingOlder ? (
                        <div className="sticky top-0 z-10 flex justify-center">
                            <span className="bg-raised text-meta text-muted flex items-center gap-1.5 rounded-full px-2.5 py-1">
                                <Spinner className="size-3" />
                                earlier messages
                            </span>
                        </div>
                    ) : null}

                    {turns.map((turn) => (
                        <TurnView key={turn.key} turn={turn} onOpenSession={onOpenSession} />
                    ))}

                    {live.compacting === true ? (
                        <CompactingMark retrying={live.compactionRetrying === true} />
                    ) : live.compactionFailed === undefined ? null : (
                        <CompactionFailedMark error={live.compactionFailed.error} />
                    )}

                    {entries.length === 0 && live.blocks === undefined ? (
                        <p className="text-prose text-faint">Nothing here yet. Ask something.</p>
                    ) : null}
                </div>
            </ScrollArea>
        </section>
    );
}
