import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { type DiffLine, diffCounts, parseDiff, piecesOf } from "../lib/diff.ts";
import { classOf, tokensOf } from "../lib/highlight.ts";

const ROW = {
    add: "bg-ok/10",
    del: "bg-danger/10",
    ctx: "",
} as const;

const SIGN = {
    add: "text-ok",
    del: "text-danger",
    ctx: "text-faint",
} as const;

const CHANGED = {
    add: "bg-ok/25 rounded-[2px]",
    del: "bg-danger/25 rounded-[2px]",
    ctx: "",
} as const;

type Tokens = { text: string; className: string }[];

const textOf = (line: Exclude<DiffLine, { type: "skip" }>): string =>
    line.spans.map((span) => span.text).join("");

/**
 * Each line's highlighted tokens, by its place in the diff. The old side (context and removed lines) and the new side
 * (context and added lines) are each highlighted as one text, so a line inside a comment or a string is coloured as
 * one; a skip starts the text again, as the lines around it are not next to each other.
 */
function useTokens(lines: DiffLine[], lang: string): Map<number, Tokens> | undefined {
    const [tokens, setTokens] = useState<{ lines: DiffLine[]; byLine: Map<number, Tokens> }>();

    useEffect(() => {
        let current = true;

        if (lang === "") {
            return undefined;
        }

        const highlight = async () => {
            const byLine = new Map<number, Tokens>();

            for (const side of ["old", "new"] as const) {
                // Runs of lines that sit next to each other in that side's file.
                const runs: number[][] = [[]];

                lines.forEach((line, at) => {
                    if (line.type === "skip") {
                        runs.push([]);
                    } else if (
                        line.type === "ctx" ||
                        line.type === (side === "old" ? "del" : "add")
                    ) {
                        runs.at(-1)?.push(at);
                    }
                });

                for (const run of runs.filter((each) => each.length > 0)) {
                    const code = run
                        .map((at) => {
                            const line = lines[at];

                            return line === undefined || line.type === "skip" ? "" : textOf(line);
                        })
                        .join("\n");
                    const rows = await tokensOf(code, lang);

                    if (rows === undefined) {
                        return;
                    }

                    run.forEach((at, row) => {
                        // A context line takes its colours from the new side.
                        if (side === "new" || lines[at]?.type === "del") {
                            byLine.set(
                                at,
                                (rows[row] ?? []).map((token) => ({
                                    text: token.content,
                                    className: classOf(token),
                                })),
                            );
                        }
                    });
                }
            }

            if (current) {
                setTokens({ lines, byLine });
            }
        };

        highlight().catch(() => {
            // A grammar that fails to load leaves the diff in its change colours only.
        });

        return () => {
            current = false;
        };
    }, [lines, lang]);

    return tokens?.lines === lines ? tokens.byLine : undefined;
}

/** Lines added and removed: the added green, the removed red, a side with none left out. */
export function Counts({ added, removed }: { added: number; removed: number }) {
    return (
        <span className="inline-flex gap-1.5 tabular-nums">
            {added > 0 || removed === 0 ? <span className="text-ok">+{added}</span> : null}
            {removed > 0 ? <span className="text-danger">−{removed}</span> : null}
        </span>
    );
}

/**
 * An edit as a card: the file above, then its lines with their numbers, highlighted as code, the words that changed
 * marked brighter.
 */
export function DiffCard({ diff, path, lang }: { diff: string; path?: string; lang: string }) {
    const lines = useMemo(() => parseDiff(diff), [diff]);
    const tokens = useTokens(lines, lang);
    const width = String(
        Math.max(0, ...lines.map((line) => (line.type === "skip" ? 0 : line.num))),
    ).length;

    return (
        <div className="rounded-card border-edge-soft bg-sunken min-w-0 overflow-hidden border">
            {path === undefined ? null : (
                <div className="border-edge-soft text-meta text-muted flex h-8 items-center gap-3 border-b px-3 font-mono">
                    <span className="min-w-0 flex-1 truncate">{path}</span>
                    <Counts {...diffCounts(diff)} />
                </div>
            )}
            <div className="overflow-x-auto py-1 font-mono text-[12.5px] leading-relaxed">
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
                                <span
                                    className="text-faint shrink-0 pr-2 pl-3 text-right tabular-nums select-none"
                                    style={{ width: `${String(width + 2)}ch` }}
                                >
                                    {line.num}
                                </span>
                                <span className={cn("w-4 shrink-0 select-none", SIGN[line.type])}>
                                    {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
                                </span>
                                <span className="text-ink whitespace-pre">
                                    {piecesOf(line.spans, tokens?.get(at)).map((piece, index) => (
                                        <span
                                            // oxlint-disable-next-line react/no-array-index-key -- pieces of one line have no id
                                            key={index}
                                            className={cn(
                                                piece.className,
                                                piece.changed && CHANGED[line.type],
                                            )}
                                        >
                                            {piece.text}
                                        </span>
                                    ))}
                                </span>
                            </div>
                        ),
                    )}
                </div>
            </div>
        </div>
    );
}
