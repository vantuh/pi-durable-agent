import { getHighlighterType } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { useRef } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { applyDiffLayout } from "@/lib/diff-layout.ts";
import { DiffCard } from "@/ui/diff/diff-card.tsx";
import { CodeBlock } from "@/ui/markdown/code-block.tsx";

import { HistoryList } from "../history-list.tsx";
import { PatchPreview } from "../preview.tsx";

import "@/styles/styles.css";

const diff =
    " 1 const stable = true;\n-2 const message = 'old';\n+2 const message = 'нове 😀';\n+3 const extra = true;\n 3 export {};";
const patch =
    Array.from({ length: 30 }, (_file, file) =>
        [
            `diff --git a/file-${String(file)}.ts b/file-${String(file)}.ts`,
            `--- a/file-${String(file)}.ts`,
            `+++ b/file-${String(file)}.ts`,
            "@@ -1,300 +1,300 @@",
            ...Array.from({ length: 300 }, (_, row) => [
                `-const value${String(row)} = 'old';`,
                `+const value${String(row)} = 'new';`,
            ]).flat(),
        ].join("\n"),
    ).join("\n") + "\n";
const data = {
    patch,
    files: Array.from({ length: 30 }, (_, index) => ({
        path: `file-${String(index)}.ts`,
        added: 300,
        deleted: 300,
        binary: false,
    })),
    truncated: false,
};

const history = {
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    changes: 0,
    more: false,
    commits: Array.from({ length: 60 }, (_, index) => ({
        hash: `${String(index).padStart(2, "0")}abcdef`,
        short: `${String(index).padStart(2, "0")}abc`,
        subject: `Commit number ${String(index)}`,
        body: "",
        author: "Someone",
        at: 1_700_000_000_000,
        unpushed: false,
        remote: false,
    })),
};
const rows = { current: new Map<string, HTMLButtonElement>() };

function DiffPage() {
    const view = useRef<CodeViewHandle<undefined, undefined>>(null);
    Object.assign(window, {
        diffFixture: {
            layout: applyDiffLayout,
            highlighter: getHighlighterType,
        },
    });
    return (
        <main className="bg-panel flex h-full flex-col gap-4 overflow-y-auto p-4">
            <section id="edit">
                <DiffCard diff={diff} path="demo.ts" />
            </section>
            <section id="broken">
                <DiffCard diff={"-1 old\nunknown output"} path="broken.ts" />
            </section>
            <section id="wide">
                <TooltipProvider>
                    <CodeBlock
                        code={`const long = "${"x".repeat(400)}";\nconst short = 1;`}
                        lang="ts"
                    />
                </TooltipProvider>
            </section>
            <section id="cut">
                <DiffCard diff={"-1 old\n+1 new\n … 19 more lines"} path="cut.ts" />
            </section>
            <section
                id="list"
                className="flex shrink-0"
                style={{ height: "calc(var(--spacing) * 64)" }}
            >
                <HistoryList
                    id={1}
                    data={history}
                    issue={null}
                    loading={false}
                    limit={50}
                    now={1_700_000_000_000}
                    viewed={null}
                    seen={new Set()}
                    rows={rows}
                    onUnread={() => undefined}
                    onOpen={() => undefined}
                    onMore={() => undefined}
                />
            </section>
            <section
                id="history"
                className="flex shrink-0"
                style={{ height: "calc(var(--spacing) * 96)" }}
            >
                <TooltipProvider>
                    <PatchPreview viewRef={view} data={data} header={<p>Git history</p>} />
                </TooltipProvider>
            </section>
        </main>
    );
}

const root = document.getElementById("root");
if (root === null) {
    throw new Error("Missing diff fixture root");
}
createRoot(root).render(<DiffPage />);
