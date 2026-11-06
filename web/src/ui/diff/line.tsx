import type { DiffSpan } from "@/lib/diff.ts";
import { piecesOf } from "@/lib/diff.ts";
import { cn } from "@/lib/utils";

import { CHANGED, SIGN } from "./tones.ts";
import type { Tokens } from "./use-tokens.ts";

/** A line as it reads in one column: its number, its sign, and its text with the words that changed marked. */
export function Line({
    type,
    num,
    spans,
    tokens,
    width,
}: {
    type: "add" | "del" | "ctx";
    num: number;
    spans: DiffSpan[];
    tokens: Tokens | undefined;
    width: number;
}) {
    return (
        <>
            <span
                className="text-faint shrink-0 pr-2 pl-3 text-right tabular-nums select-none"
                style={{ width: `${String(width + 2)}ch` }}
            >
                {num}
            </span>
            <span className={cn("w-4 shrink-0 select-none", SIGN[type])}>
                {type === "add" ? "+" : type === "del" ? "−" : ""}
            </span>
            <span className="text-ink whitespace-pre">
                {piecesOf(spans, tokens).map((piece, index) => (
                    <span
                        // oxlint-disable-next-line react/no-array-index-key -- pieces of one line have no id
                        key={index}
                        className={cn(piece.className, piece.changed && CHANGED[type])}
                    >
                        {piece.text}
                    </span>
                ))}
            </span>
        </>
    );
}
