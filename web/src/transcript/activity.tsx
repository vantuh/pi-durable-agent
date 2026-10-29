import {
    ChevronRight,
    FilePlus,
    FileText,
    Folder,
    type LucideIcon,
    Minus,
    Pencil,
    Search,
    Sparkle,
    Terminal,
    Wrench,
    X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { type FolderToolIcon, useToolIcons } from "../extensions.ts";
import { langOfPath } from "../lib/highlight.ts";
import {
    argOf,
    type GroupImage,
    imagesOf,
    type Item,
    outcomeOf,
    type Step,
    type StepStatus,
    subjectOf,
    summarize,
} from "../lib/turns.ts";
import { ImageThumbs } from "../ui/attachments.tsx";
import { Counts, DiffCard } from "../ui/diff.tsx";
import { CodeBlock } from "../ui/markdown.tsx";
import { useSession } from "./session.ts";

/** The current time, every second while `live`; a settled clock never redraws. */
export function useNow(live: boolean): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!live) {
            return undefined;
        }

        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, [live]);

    return now;
}

export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));

    if (seconds < 60) {
        return `${String(seconds)}s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${String(minutes)}m ${String(seconds % 60)}s`;
    }

    return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function Chevron() {
    return (
        <ChevronRight className="text-faint size-3.5 shrink-0 transition-transform group-data-[state=open]/fold:rotate-90" />
    );
}

const MARK_TONES = {
    thought: "bg-spark/15 text-spark",
    pending: "bg-accent/15 text-accent",
    running: "bg-accent/15 text-accent",
    done: "bg-ok/15 text-ok",
    error: "bg-danger/15 text-danger",
    stopped: "bg-raised text-faint",
} as const;

/** What kind of core call a step is, as its mark's icon: the tone says how it went. Extensions bring their own. */
const TOOL_ICONS: Record<string, LucideIcon> = {
    bash: Terminal,
    read: FileText,
    edit: Pencil,
    write: FilePlus,
    grep: Search,
    find: Search,
    ls: Folder,
};

type ExtensionIcons = readonly FolderToolIcon[];

/** How a step went, in a circle on the timeline's rule; the canvas ring cuts the rule around it. */
function Mark({
    tone,
    tool,
    icons,
}: {
    tone: StepStatus | "thought";
    tool?: string;
    icons?: ExtensionIcons;
}) {
    // While it runs, and when it failed or never ran, the mark says how it stands, as Pi Pocket's does; once done, what
    // kind of call it was.
    const Icon =
        tone === "thought"
            ? Sparkle
            : tone === "error"
              ? X
              : tone === "stopped"
                ? Minus
                : (TOOL_ICONS[tool ?? ""] ??
                  icons?.find((each) => each.id === tool)?.icon ??
                  Wrench);
    const label =
        tone === "error"
            ? "Failed"
            : tone === "stopped"
              ? "Did not run"
              : tone === "done"
                ? "Done"
                : undefined;

    return (
        <span className="bg-canvas ring-canvas relative shrink-0 rounded-full ring-3">
            <span
                {...(label === undefined ? {} : { "aria-label": label, role: "img" })}
                className={cn("grid size-[19px] place-items-center rounded-full", MARK_TONES[tone])}
            >
                {tone === "pending" || tone === "running" ? (
                    <Spinner className="size-2.5" />
                ) : (
                    <Icon aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
                )}
            </span>
        </span>
    );
}

function Pre({ children, tone }: { children: string; tone?: "danger" }) {
    return (
        <ScrollArea className="rounded-control bg-sunken" viewportProps={{ className: "max-h-72" }}>
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

function ThoughtBody({ text }: { text: string }) {
    return (
        <p className="rounded-control border-spark/30 bg-sunken text-tool text-muted border-l-2 px-3 py-2.5 whitespace-pre-wrap italic">
            {text}
        </p>
    );
}

/** What an open step shows: an edit's diff, a write's file, or else its arguments and output. */
function StepBody({ step }: { step: Extract<Step, { kind: "tool" }> }) {
    const output = step.result?.text.trim() ?? "";
    const path = argOf(step.args, "path");
    const content = step.name === "write" ? argOf(step.args, "content") : undefined;
    const failed = step.status === "error";

    if (!failed && step.result?.diff !== undefined) {
        return (
            <DiffCard
                diff={step.result.diff}
                lang={langOfPath(path)}
                {...(path === undefined ? {} : { path })}
            />
        );
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
            <Pre>{argsText(step.name, step.args)}</Pre>
            {output === "" ? null : (
                <Pre {...(failed ? { tone: "danger" as const } : {})}>{output}</Pre>
            )}
            {step.result?.truncated === true ? (
                <p className="text-meta text-faint">Output cut for the screen.</p>
            ) : null}
        </>
    );
}

const STEP_HEAD =
    "hover:bg-raised/50 flex min-h-[34px] w-full min-w-0 items-center gap-2.5 pr-3.5 pl-[13px] text-left";

/** Under a step's line, in line with its label. */
const STEP_BODY = "mt-1.5 mr-3.5 mb-3 ml-[42px] flex min-w-0 flex-col gap-2";

function imageUrl(session: number, image: GroupImage): string {
    return `/api/entry-image?session=${String(session)}&entry=${String(image.entry)}&index=${String(image.index)}`;
}

/** Pictures the group's calls returned, below its lines: seen without opening a call. */
function GroupImages({ steps }: { steps: Step[] }) {
    const session = useSession();
    const images = imagesOf(steps);

    if (session === null || images.length === 0) {
        return null;
    }

    return (
        <ImageThumbs
            images={images.map((image) => ({
                src: imageUrl(session, image),
                name: image.name,
            }))}
        />
    );
}

function StepRow({ step, icons }: { step: Step; icons: ExtensionIcons }) {
    if (step.kind === "thinking") {
        return (
            <Collapsible>
                <CollapsibleTrigger className={STEP_HEAD}>
                    <Mark tone="thought" />
                    <span
                        className={cn(
                            "text-ink font-mono text-[12.5px] font-semibold",
                            step.streaming && "shimmer",
                        )}
                    >
                        {step.streaming ? "Thinking…" : "Thought"}
                    </span>
                </CollapsibleTrigger>
                <CollapsibleContent className={STEP_BODY}>
                    <ThoughtBody text={step.text} />
                </CollapsibleContent>
            </Collapsible>
        );
    }

    const subject = subjectOf(step.name, step.args);
    const outcome = outcomeOf(step);
    const took = step.result?.durationMs;

    return (
        <Collapsible>
            <CollapsibleTrigger className={STEP_HEAD}>
                <Mark tone={step.status} tool={step.name} icons={icons} />
                <span className="text-ink max-w-[45%] shrink-0 truncate font-mono text-[12.5px] font-semibold">
                    {step.name}
                </span>
                <span className="text-muted min-w-0 flex-1 truncate font-mono text-[12.5px]">
                    {subject ?? ""}
                </span>
                {outcome === undefined ? null : (
                    <span
                        {...(took === undefined ? {} : { title: `took ${formatDuration(took)}` })}
                        className={cn(
                            "max-w-[40%] shrink-0 truncate font-mono text-[11px] tabular-nums",
                            outcome.tone === "ok"
                                ? "text-ok"
                                : outcome.tone === "danger"
                                  ? "text-danger"
                                  : "text-muted",
                        )}
                    >
                        {outcome.counts === undefined ? (
                            outcome.text
                        ) : (
                            <Counts {...outcome.counts} />
                        )}
                    </span>
                )}
            </CollapsibleTrigger>
            <CollapsibleContent className={STEP_BODY}>
                <StepBody step={step} />
            </CollapsibleContent>
        </Collapsible>
    );
}

/**
 * Pi's thinking and tool calls between two of its words, as one card: a line that says what they did, how many failed,
 * and how long they took. Folded by default, also while live; it opens into a timeline with one line per step.
 */
export function ActivityGroup({ item }: { item: Extract<Item, { type: "activity" }> }) {
    const now = useNow(item.live);
    const icons = useToolIcons();
    const last = item.steps.at(-1);
    const thinking = item.live && last?.kind === "thinking" && last.streaming;
    const failed = item.steps.filter(
        (step) => step.kind === "tool" && step.status === "error",
    ).length;
    const until = item.live ? now : item.endedAt;
    const lone = item.steps.length === 1 && last?.kind === "thinking" ? last : undefined;

    return (
        <>
            <Collapsible className="group/fold rounded-card border-edge-soft min-w-0 overflow-hidden border">
                <CollapsibleTrigger className="text-tool text-muted hover:bg-raised/50 hover:text-ink group-data-[state=open]/fold:border-edge-soft flex min-h-9 w-full min-w-0 items-center gap-2.5 px-3 text-left group-data-[state=open]/fold:border-b">
                    <Chevron />
                    <span className={cn("min-w-0 flex-1 truncate", item.live && "shimmer")}>
                        {summarize(item.steps, thinking)}
                    </span>
                    {failed > 0 ? (
                        <span className="bg-danger/15 text-danger shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium">
                            {failed} failed
                        </span>
                    ) : null}
                    {item.startedAt === undefined || until === undefined ? null : (
                        <span
                            className={cn(
                                "shrink-0 font-mono text-[11.5px] tabular-nums",
                                item.live ? "text-accent" : "text-faint",
                            )}
                        >
                            {formatDuration(until - item.startedAt)}
                        </span>
                    )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                    {lone === undefined ? (
                        <div className="relative py-1.5">
                            <span
                                aria-hidden="true"
                                className="bg-edge absolute top-5 bottom-5 left-[22px] w-px"
                            />
                            {item.steps.map((step) => (
                                <StepRow key={step.key} step={step} icons={icons} />
                            ))}
                        </div>
                    ) : (
                        <div className="px-3 py-2.5">
                            <ThoughtBody text={lone.text} />
                        </div>
                    )}
                </CollapsibleContent>
            </Collapsible>
            <GroupImages steps={item.steps} />
        </>
    );
}
