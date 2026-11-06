import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { splitStable } from "@/lib/markdown-split.ts";
import { cn } from "@/lib/utils";

import { COMPONENTS } from "./markdown/components.tsx";

// The path extensions import it by, until phase 8 points them at ui/markdown/code-block.tsx.
export { CodeBlock } from "./markdown/code-block.tsx";

const Blocks = memo(function Blocks({ text }: { text: string }): ReactNode {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
            {text}
        </ReactMarkdown>
    );
});

/**
 * Pi's words as Markdown, GitHub's flavour: tables, task lists, strikethrough, autolinks. A reply that is
 * still arriving is parsed in two parts, so a frame re-parses its last blocks and not the whole text; a
 * finished one is a single parse.
 */
export const Markdown = memo(function Markdown({
    text,
    streaming = false,
}: {
    text: string;
    streaming?: boolean;
}): ReactNode {
    const { stable, tail } = streaming ? splitStable(text) : { stable: "", tail: text };

    return (
        <div
            className={cn(
                "text-interface text-ink flex min-w-0 flex-col gap-3 leading-relaxed break-words",
                streaming && "streaming",
            )}
        >
            {stable === "" ? null : <Blocks text={stable} />}
            <Blocks text={tail} />
        </div>
    );
});
