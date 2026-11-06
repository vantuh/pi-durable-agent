import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiffRow } from "@/lib/diff.ts";
import { cn } from "@/lib/utils";

import { Line } from "./line.tsx";
import { ROW } from "./tones.ts";
import type { Tokens } from "./use-tokens.ts";

/** One file's side of the rows: the lines of the old file, or of the new one. */
function SplitColumn({
    side,
    rows,
    tokens,
    width,
}: {
    side: "left" | "right";
    rows: DiffRow[];
    tokens: Map<number, Tokens> | undefined;
    width: number;
}) {
    return (
        <div className={cn("min-w-0 flex-1", side === "right" && "border-edge-soft border-l")}>
            <ScrollArea orientation="horizontal">
                <div className="min-w-max">
                    {rows.map((row, at) => {
                        if (row.type === "skip") {
                            return side === "left" ? (
                                <div
                                    // oxlint-disable-next-line react/no-array-index-key -- rows of one diff have no id
                                    key={at}
                                    className="text-faint min-h-[1lh] px-3 select-none"
                                >
                                    {row.text}
                                </div>
                            ) : (
                                // oxlint-disable-next-line react/no-array-index-key -- likewise
                                <div key={at} className="min-h-[1lh]" />
                            );
                        }

                        const cell = side === "left" ? row.left : row.right;

                        return (
                            <div
                                // oxlint-disable-next-line react/no-array-index-key -- likewise
                                key={at}
                                className={cn(
                                    "flex min-h-[1lh] pr-3",
                                    cell !== undefined && ROW[cell.type],
                                )}
                            >
                                {cell === undefined ? null : (
                                    <Line
                                        type={cell.type}
                                        num={cell.num}
                                        spans={cell.spans}
                                        tokens={tokens?.get(cell.at)}
                                        width={width}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
}

/** The old file on the left, the new on the right, each scrolling on its own. */
export function SplitBody({
    rows,
    tokens,
    width,
}: {
    rows: DiffRow[];
    tokens: Map<number, Tokens> | undefined;
    width: number;
}) {
    return (
        <div className="flex">
            <SplitColumn side="left" rows={rows} tokens={tokens} width={width} />
            <SplitColumn side="right" rows={rows} tokens={tokens} width={width} />
        </div>
    );
}
