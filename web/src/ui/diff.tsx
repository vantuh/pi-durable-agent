import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { currentDiffLayout, watchDiffLayout } from "../lib/diff-layout.ts";
import {
    type DiffLine,
    type DiffRow,
    type DiffSpan,
    diffCounts,
    diffRows,
    parseDiff,
    piecesOf,
} from "../lib/diff.ts";
import { classOf, tokensOf } from "../lib/highlight.ts";
import { PANE } from "./pane.tsx";

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
    add: "bg-ok/25 rounded-mark",
    del: "bg-danger/25 rounded-mark",
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

/** Narrower than this, two columns are each too narrow to read: the card keeps one. */
const SPLIT_FROM = 560;

/** A line as it reads in one column: its number, its sign, and its text with the words that changed marked. */
function Line({
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
function SplitBody({
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

/** Whether the card itself has room for two columns: the conversation column is not the window. */
function useRoom(): [RefObject<HTMLDivElement | null>, boolean] {
    const root = useRef<HTMLDivElement>(null);
    const [room, setRoom] = useState(() => window.innerWidth >= SPLIT_FROM);

    useEffect(() => {
        const box = root.current;

        if (box === null) {
            return undefined;
        }

        const measure = (): void => {
            setRoom(box.clientWidth >= SPLIT_FROM);
        };
        const observer = new ResizeObserver(measure);

        observer.observe(box);
        measure();

        return () => {
            observer.disconnect();
        };
    }, []);

    return [root, room];
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
