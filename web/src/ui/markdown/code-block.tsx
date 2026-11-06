import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { tokensOf } from "@/lib/highlight.ts";

import { PANE } from "../pane.tsx";
import { CodeText } from "./code-text.tsx";

/**
 * A fenced block: its language and a copy button above, the code highlighted below. While the code still grows, the
 * last highlighted version shows with the new text after it plain, so a streamed block does not flicker.
 */
export function CodeBlock({
    code,
    lang,
    title,
    highlight = tokensOf,
    lineClassName,
}: {
    code: string;
    lang: string;
    title?: string;
    highlight?: typeof tokensOf;
    lineClassName?: (row: number) => string | undefined;
}) {
    const [copied, setCopied] = useState(false);

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
            <ScrollArea orientation="horizontal">
                <pre className="text-ink text-code w-max min-w-full px-3 py-2.5 font-mono leading-relaxed">
                    <code>
                        <CodeText
                            code={code}
                            lang={lang}
                            highlight={highlight}
                            lineClassName={lineClassName}
                        />
                    </code>
                </pre>
            </ScrollArea>
        </div>
    );
}
