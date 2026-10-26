import { PanelLeft, Settings as SettingsIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import type { ClientBlock, ClientEntry, ClientLive, ClientTool } from "../../../shared/protocol.ts";

type Props = {
    title: string | null;
    entries: ClientEntry[];
    live: ClientLive;
    onSettings: () => void;
    onSessions: () => void;
};

function Blocks({ blocks }: { blocks: ClientBlock[] }) {
    return (
        <>
            {blocks.map((block, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- a message's blocks carry no id; their order is the identity
                <div key={at} className="flex flex-col gap-1.5">
                    {block.type === "text" ? (
                        <p className="text-prose text-ink whitespace-pre-wrap">{block.text}</p>
                    ) : block.type === "thinking" ? (
                        <p className="text-meta text-faint whitespace-pre-wrap italic">
                            {block.text}
                        </p>
                    ) : (
                        <p className="text-meta text-muted font-mono">⌘ {block.name}</p>
                    )}
                </div>
            ))}
        </>
    );
}

function Tools({ tools }: { tools: ClientTool[] }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
                <span
                    key={tool.callId}
                    className="bg-raised text-meta text-muted rounded-full px-2 py-0.5 font-mono"
                >
                    {tool.name}
                    {tool.status === "done" ? "" : " …"}
                </span>
            ))}
        </div>
    );
}

function Entry({ entry }: { entry: ClientEntry }) {
    if (entry.kind === "user") {
        return (
            <div className="flex justify-end">
                <p className="rounded-card bg-raised text-prose text-ink max-w-[80%] px-3 py-2 whitespace-pre-wrap">
                    {entry.text}
                </p>
            </div>
        );
    }

    if (entry.kind === "assistant") {
        return (
            <div className="flex flex-col gap-1.5">
                <Blocks blocks={entry.blocks} />
                {entry.error === undefined ? null : (
                    <p className="text-meta text-danger">{entry.error}</p>
                )}
            </div>
        );
    }

    // Tool results are folded into one line per group by the next step; until then the call alone shows.
    return null;
}

export function Transcript({ title, entries, live, onSettings, onSessions }: Props) {
    const bottom = useRef<HTMLDivElement>(null);
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
                    {entries.map((entry) => (
                        <Entry key={entry.id} entry={entry} />
                    ))}

                    {live.blocks === undefined ? null : (
                        <div className="flex flex-col gap-1.5">
                            <Blocks blocks={live.blocks} />
                        </div>
                    )}

                    {live.tools === undefined ? null : <Tools tools={live.tools} />}

                    {entries.length === 0 && live.blocks === undefined ? (
                        <p className="text-prose text-faint">Nothing here yet. Ask something.</p>
                    ) : null}

                    <div ref={bottom} />
                </div>
            </div>
        </section>
    );
}
