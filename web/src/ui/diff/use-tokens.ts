import { useEffect, useState } from "react";

import type { DiffLine } from "@/lib/diff.ts";
import { classOf, tokensOf } from "@/lib/highlight.ts";

export type Tokens = { text: string; className: string }[];

const textOf = (line: Exclude<DiffLine, { type: "skip" }>): string =>
    line.spans.map((span) => span.text).join("");

/**
 * Each line's highlighted tokens, by its place in the diff. The old side (context and removed lines) and the new side
 * (context and added lines) are each highlighted as one text, so a line inside a comment or a string is coloured as
 * one; a skip starts the text again, as the lines around it are not next to each other.
 */
export function useTokens(lines: DiffLine[], lang: string): Map<number, Tokens> | undefined {
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
