import { ScrollArea } from "@/components/ui/scroll-area";
import type { FolderToolView } from "@/extensions.ts";
import { langOfPath } from "@/lib/highlight.ts";
import { argOf } from "@/lib/step-summary.ts";
import type { Step } from "@/lib/turns.ts";
import { cn } from "@/lib/utils";
import { DiffCard } from "@/ui/diff/diff-card.tsx";
import { CodeBlock } from "@/ui/markdown/code-block.tsx";

function Pre({ children, tone }: { children: string; tone?: "danger" }) {
    return (
        <ScrollArea className="bg-sunken" viewportProps={{ className: "max-h-72" }}>
            <pre
                className={cn(
                    "text-meta px-2.5 py-2 font-mono whitespace-pre-wrap break-all",
                    tone === "danger" ? "text-danger" : "text-muted",
                )}
            >
                {children}
            </pre>
        </ScrollArea>
    );
}

function argsText(name: string, args: unknown): string {
    const command = name === "bash" ? argOf(args, "command") : undefined;

    return command === undefined ? JSON.stringify(args, null, 2) : `$ ${command}`;
}

/** What an open step shows: an edit's diff, a written or read file, or else its arguments and output. */
export function StepBody({
    step,
    views,
}: {
    step: Extract<Step, { kind: "tool" }>;
    views: readonly FolderToolView[];
}) {
    const output = step.result?.text.trim() ?? "";
    const path = argOf(step.args, "path");
    const content =
        step.name === "write"
            ? argOf(step.args, "content")
            : step.name === "read" && output !== ""
              ? output
              : undefined;
    const failed = step.status === "error";

    if (!failed && step.result?.diff !== undefined) {
        return <DiffCard diff={step.result.diff} {...(path === undefined ? {} : { path })} />;
    }

    if (!failed && content !== undefined) {
        return (
            <CodeBlock
                code={content}
                lang={langOfPath(path)}
                {...(path === undefined ? {} : { title: path })}
            />
        );
    }

    return (
        <>
            {views.find((view) => view.id === step.name)?.args(step.args) ?? (
                <Pre>{argsText(step.name, step.args)}</Pre>
            )}
            {output === "" ? null : (
                <Pre {...(failed ? { tone: "danger" as const } : {})}>{output}</Pre>
            )}
            {step.result?.truncated === true ? (
                <p className="text-meta text-faint">Output cut for the screen.</p>
            ) : null}
        </>
    );
}
