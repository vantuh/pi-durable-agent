import { PanelLeft } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button, REACH } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";

import type { ClientEntry, ClientLive } from "../../../shared/protocol.ts";
import { turnsOf } from "../lib/turns.ts";
import { addComposerQuote, focusComposer } from "../sdk/composer.ts";
import { CompactingMark } from "./compaction/compacting-mark.tsx";
import { CompactionFailedMark } from "./compaction/compaction-failed-mark.tsx";
import { LoadingTurn } from "./loading/loading-turn.tsx";
import { OlderRoom } from "./loading/older-room.tsx";
import { SelectionQuote } from "./selection-quote.tsx";
import { SessionContext } from "./session.ts";
import { TurnView } from "./turn/turn-view.tsx";
import { useTranscriptScroll } from "./use-transcript-scroll.ts";

type Props = {
    session: number;
    title: string | null;
    entries: ClientEntry[];
    live: ClientLive;
    /** Buttons of the extensions' panels. */
    tools?: ReactNode;
    onSessions: () => void;
    /** Goes to another conversation, the one an agent's message came from. */
    onOpenSession: (session: number) => void;
    /** A small line under the title: the branch, as extensions add it. */
    below: ReactNode;
    /** Asks the server for the page older than what is on screen. */
    /** `settled` resolves when the page may land: a reader mid-fling on a browser that cannot anchor makes it wait. */
    onLoadOlder: (settled: () => Promise<void>) => Promise<void>;
    /** The conversation's first entry is on screen: scrolling up asks for nothing more. */
    exhausted: boolean;
    /** The stream has not answered for this conversation yet, so an empty screen may still fill. */
    loading: boolean;
};

export function Transcript({
    session,
    title,
    entries,
    live,
    tools,
    onSessions,
    onOpenSession,
    below,
    onLoadOlder,
    exhausted,
    loading,
}: Props) {
    const { scroller, content, scrolling } = useTranscriptScroll(entries, exhausted, onLoadOlder);
    const turns = useMemo(() => turnsOf(entries, live), [entries, live]);

    return (
        <section className="bg-canvas flex min-h-0 flex-1 flex-col">
            <header className="border-edge-soft min-h-header flex items-center justify-between gap-3 border-b px-3 py-0.5">
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
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
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h1 className="text-interface text-ink truncate leading-5 font-medium">
                            {title ?? "New session"}
                        </h1>
                        <div className="flex min-w-0 items-center gap-2 empty:hidden">{below}</div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">{tools}</div>
            </header>

            <ScrollArea
                className="min-h-0 flex-1"
                viewportRef={scroller}
                viewportProps={{
                    className: "px-4 py-4",
                    ...scrolling,
                }}
            >
                <div
                    ref={content}
                    className="mx-auto flex max-w-[var(--chat-width)] flex-col gap-4"
                >
                    {exhausted || entries.length === 0 ? null : <OlderRoom />}

                    <SessionContext value={session}>
                        {turns.map((turn) => (
                            <TurnView key={turn.key} turn={turn} onOpenSession={onOpenSession} />
                        ))}
                    </SessionContext>

                    {live.compacting === true ? (
                        <CompactingMark retrying={live.compactionRetrying === true} />
                    ) : live.compactionFailed === undefined ? null : (
                        <CompactionFailedMark error={live.compactionFailed.error} />
                    )}

                    {entries.length === 0 && live.blocks === undefined ? (
                        loading ? (
                            <>
                                <LoadingTurn />
                                <output className="sr-only">Opening the session…</output>
                            </>
                        ) : (
                            <Empty className="text-interface">
                                Nothing here yet. Ask something.
                            </Empty>
                        )
                    ) : null}
                </div>
            </ScrollArea>

            <SelectionQuote
                onQuote={(text) => {
                    addComposerQuote(String(session), text);
                    focusComposer();
                }}
            />
        </section>
    );
}
