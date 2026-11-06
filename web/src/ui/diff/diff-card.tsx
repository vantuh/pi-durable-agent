import { useMemo, useSyncExternalStore } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { currentDiffLayout, watchDiffLayout } from "@/lib/diff-layout.ts";
import { diffCounts, diffRows, parseDiff } from "@/lib/diff.ts";
import { cn } from "@/lib/utils";

import { PANE } from "../pane.tsx";
import { Counts } from "./counts.tsx";
import { Line } from "./line.tsx";
import { SplitBody } from "./split-body.tsx";
import { ROW } from "./tones.ts";
import { useRoom } from "./use-room.ts";
import { useTokens } from "./use-tokens.ts";

/**
 * An edit as a card: the file above, then its lines with their numbers, highlighted as code, the words that changed
 * marked brighter.
 */
export function DiffCard({ diff, path, lang }: { diff: string; path?: string; lang: string }) {
    const lines = useMemo(() => parseDiff(diff), [diff]);
    const tokens = useTokens(lines, lang);
    const layout = useSyncExternalStore(watchDiffLayout, currentDiffLayout);
    const [root, room] = useRoom();
    const split = layout === "split" && room;
    const rows = useMemo(() => diffRows(lines), [lines]);
    const width = String(
        Math.max(0, ...lines.map((line) => (line.type === "skip" ? 0 : line.num))),
    ).length;

    return (
        <div ref={root} className={`${PANE} bg-sunken min-w-0 overflow-hidden`}>
            {path === undefined ? null : (
                <div className="border-edge-soft text-meta text-muted flex h-8 items-center gap-3 border-b px-3 font-mono">
                    <span className="min-w-0 flex-1 truncate">{path}</span>
                    <Counts {...diffCounts(diff)} />
                </div>
            )}
            <div className="text-code py-1 font-mono leading-relaxed">
                {split ? (
                    <SplitBody rows={rows} tokens={tokens} width={width} />
                ) : (
                    <ScrollArea orientation="horizontal">
                        <div className="min-w-max">
                            {lines.map((line, at) =>
                                line.type === "skip" ? (
                                    // oxlint-disable-next-line react/no-array-index-key -- lines of one diff have no id; their order is the identity
                                    <div key={at} className="text-faint px-3 select-none">
                                        {line.text}
                                    </div>
                                ) : (
                                    // oxlint-disable-next-line react/no-array-index-key -- likewise
                                    <div key={at} className={cn("flex pr-3", ROW[line.type])}>
                                        <Line
                                            type={line.type}
                                            num={line.num}
                                            spans={line.spans}
                                            tokens={tokens?.get(at)}
                                            width={width}
                                        />
                                    </div>
                                ),
                            )}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
