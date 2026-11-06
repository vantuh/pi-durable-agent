import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThemedToken } from "shiki";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { classOf, tokensOf } from "@/lib/highlight.ts";

import { PANE } from "../pane.tsx";

type Highlighted = { code: string; lines: ThemedToken[][] };

/** How long a block that is still arriving waits for its text to pause before it is highlighted again. */
const HIGHLIGHT_DELAY_MS = 150;

/**
 * A fenced block: its language and a copy button above, the code highlighted below. While the code still grows, the
 * last highlighted version shows with the new text after it plain, so a streamed block does not flicker.
 */
export function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
    const [shown, setShown] = useState<Highlighted | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    /** A block that arrived whole is highlighted at once; one whose text is still coming waits for it to pause. */
    const first = useRef(true);

    useEffect(() => {
        let current = true;

        if (lang === "") {
            return undefined;
        }

        const highlight = async () => {
            try {
                const lines = await tokensOf(code, lang);

                if (current && lines !== undefined) {
                    setShown({ code, lines });
                }
            } catch {
                // A grammar that fails to load leaves the code plain.
            }
        };

        // Shiki's tokens are the whole block, so re-highlighting one that is still arriving would redo all of it for
        // every 100 ms chunk: it waits for the text to stop instead, and the new text shows plain meanwhile.
        const timer = setTimeout(
            () => {
                void highlight();
            },
            first.current ? 0 : HIGHLIGHT_DELAY_MS,
        );

        first.current = false;

        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [code, lang]);

    useEffect(() => {
        if (!copied) {
            return undefined;
        }

        const timer = setTimeout(() => {
            setCopied(false);
        }, 1500);

        return () => {
            clearTimeout(timer);
        };
    }, [copied]);

    const fresh = shown !== undefined && code.startsWith(shown.code) ? shown : undefined;

    return (
        <div className={`${PANE} bg-sunken min-w-0 overflow-hidden`}>
            <div className="border-edge-soft text-meta text-faint flex h-8 items-center justify-between border-b pr-1.5 pl-3 font-mono">
                <span className="truncate">{title ?? (lang === "" ? "text" : lang)}</span>
                <Hint label={copied ? "Copied" : "Copy"}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={copied ? "Copied" : "Copy"}
                        onClick={() => {
                            const copy = async () => {
                                try {
                                    await navigator.clipboard.writeText(code);
                                    setCopied(true);
                                } catch {
                                    // No clipboard (an insecure origin): the icon stays as it was.
                                }
                            };

                            void copy();
                        }}
                        className="text-faint"
                    >
                        {copied ? (
                            <Check className="text-ok size-3.5" />
                        ) : (
                            <Copy className="size-3.5" />
                        )}
                    </Button>
                </Hint>
            </div>
            <pre className="text-ink text-code overflow-x-auto px-3 py-2.5 font-mono leading-relaxed">
                <code>
                    {fresh === undefined
                        ? code
                        : fresh.lines.map((line, row) => (
                              // oxlint-disable-next-line react/no-array-index-key -- lines of one code have no id; their order is the identity
                              <span key={row}>
                                  {line.map((token, at) => (
                                      // oxlint-disable-next-line react/no-array-index-key -- tokens of one line, likewise
                                      <span key={at} className={classOf(token)}>
                                          {token.content}
                                      </span>
                                  ))}
                                  {row < fresh.lines.length - 1 ? "\n" : null}
                              </span>
                          ))}
                    {fresh === undefined ? null : code.slice(fresh.code.length)}
                </code>
            </pre>
        </div>
    );
}
