import { useMemo } from "react";

import { CodeBlock } from "@/ui/markdown/code-block.tsx";
import { CodeText } from "@/ui/markdown/code-text.tsx";

import { embedded } from "./embedded.ts";
import { commandTokens } from "./highlight.ts";

export function CommandCode({ command, framed = false }: { command: string; framed?: boolean }) {
    const marked = useMemo(() => {
        const ranges = embedded(command);
        const rows = new Set<number>();
        let pos = 0;

        command.split("\n").forEach((line, row) => {
            const end = pos + line.length;

            if (ranges.some((range) => range.pos <= pos && pos < range.end && end <= range.end)) {
                rows.add(row);
            }

            pos = end + 1;
        });

        return rows;
    }, [command]);
    const Renderer = framed ? CodeBlock : CodeText;

    return (
        <Renderer
            code={command}
            lang="bash"
            highlight={commandTokens}
            lineClassName={(row) =>
                marked.has(row)
                    ? "inline-block min-h-lh min-w-full border-l-2 border-command-run/50 bg-panel pl-3 align-top"
                    : undefined
            }
        />
    );
}
