import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { type Breakdown, breakdown, type Part } from "./refs.ts";

const WARN_ABOVE = 0.7;
const DANGER_ABOVE = 0.9;
const ROW =
    "grid grid-cols-[minmax(0,9rem)_1fr_4rem_3rem] items-center gap-3 text-left max-sm:grid-cols-[minmax(0,1fr)_4rem_3rem]";

/** 119, 2.7k, 18k: one decimal below 10k. */
function compact(count: number): string {
    if (count < 1000) {
        return String(count);
    }

    return count < 10_000
        ? `${(count / 1000).toFixed(1)}k`
        : `${String(Math.round(count / 1000))}k`;
}

const percent = (fill: number): string => `${String(Math.round(fill * 100))}%`;

function toneOf(fill: number): "accent" | "warn" | "danger" {
    return fill > DANGER_ABOVE ? "danger" : fill > WARN_ABOVE ? "warn" : "accent";
}

/** A share of the biggest row, not a value on its way to full: the row's numbers beside it are what it says. */
function Share({ fill }: { fill: number }) {
    return (
        <span className="bg-raised flex h-1 overflow-hidden rounded-full" aria-hidden>
            <span className="bg-accent" style={{ width: percent(Math.min(1, fill)) }} />
        </span>
    );
}

/** The cells of one row: what it holds, how much it weighs, and its share of the biggest row. */
function Cells({ part, biggest, fold }: { part: Part; biggest: number; fold?: boolean }) {
    return (
        <>
            {fold === true ? (
                <span className="text-ink flex min-w-0 items-center gap-1.5">
                    <ChevronRight className="text-faint size-3 shrink-0 transition-transform group-data-[state=open]/fold:rotate-90" />
                    <span className="truncate">{part.name}</span>
                </span>
            ) : (
                <span className="text-ink truncate">{part.name}</span>
            )}
            <span className="text-faint truncate max-sm:hidden">{part.preview}</span>
            <Share fill={part.tokens / biggest} />
            <span className="text-muted text-right">{compact(part.tokens)}</span>
        </>
    );
}

/** A part an extension installed two or more of its tools into folds open into them. */
function Row({ part, biggest }: { part: Part; biggest: number }) {
    const children = part.parts;

    if (children === undefined) {
        return (
            <div className={ROW}>
                <Cells part={part} biggest={biggest} />
            </div>
        );
    }

    return (
        <Collapsible className="group/fold flex flex-col gap-1">
            <CollapsibleTrigger className={`${ROW} hover:bg-raised/50`}>
                <Cells part={part} biggest={biggest} fold />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-1 pl-4">
                {children.map((child) => (
                    <div key={child.name} className={ROW}>
                        <Cells part={child} biggest={biggest} />
                    </div>
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}

function Group({ title, unit, parts }: { title: string; unit: string; parts: Part[] }) {
    const total = parts.reduce((sum, part) => sum + part.tokens, 0);
    const biggest = Math.max(1, ...parts.map((part) => part.tokens));
    const count = parts.reduce((sum, part) => sum + (part.parts?.length ?? 1), 0);

    return (
        <section className="flex flex-col gap-1">
            <h3 className="text-faint flex items-baseline gap-2 uppercase">
                <span className="bg-accent rounded-mark size-2.5 self-center" />
                {title}
                <span className="normal-case">{`${String(count)} ${unit}`}</span>
                <span className="text-ink ml-auto">{compact(total)}</span>
            </h3>
            {parts.map((part) => (
                <Row key={part.name} part={part} biggest={biggest} />
            ))}
        </section>
    );
}

function Popup({ data }: { data: Breakdown }) {
    const fill = data.window > 0 ? data.used / data.window : 0;

    return (
        <PopoverContent
            side="top"
            aria-label="Context breakdown"
            className="w-160 max-w-(--radix-popper-available-width) p-0 font-mono"
        >
            {/* The cap sits on the viewport: a card capped by max-height gives the area no height to fill. */}
            <ScrollArea viewportProps={{ className: "max-h-[70vh]" }}>
                <div className="text-meta text-muted flex flex-col gap-4 p-4">
                    <div className="grid grid-cols-[5rem_1fr] gap-y-1">
                        <span className="text-faint">model</span>
                        <span className="text-ink">{data.model}</span>
                        <span className="text-faint">context</span>
                        <span className="flex items-center gap-3">
                            <span className="text-ink">
                                {compact(data.used)}
                                {data.window > 0 ? ` of ${compact(data.window)}` : ""}
                            </span>
                            {data.window > 0 ? (
                                <>
                                    <Progress
                                        value={Math.round(fill * 100)}
                                        tone={toneOf(fill)}
                                        className="w-32"
                                        aria-label="context"
                                    />
                                    <span>{percent(fill)}</span>
                                </>
                            ) : null}
                        </span>
                    </div>
                    <Group title="system prompt" unit="sections" parts={data.sections} />
                    <Group title="tools" unit="tools" parts={data.tools} />
                    <p className="text-faint">
                        {data.calibrated
                            ? "Approximate: sizes are scaled to the model's own count of the first request."
                            : "Approximate: 3.5 characters per token, not the model's own count."}
                    </p>
                </div>
            </ScrollArea>
        </PopoverContent>
    );
}

function Context({ session }: StatusProps) {
    const [data, setData] = useState<Breakdown | null>(null);
    const [open, setOpen] = useState(false);
    const id = session?.id ?? null;
    const busy = session?.busy ?? false;

    useEffect(() => {
        if (id === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            let found: Breakdown | null = null;

            try {
                found = await callAction(breakdown, undefined, id);
            } catch {
                found = null;
            }

            if (alive) {
                setData(found);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run ending (busy going false) commits a new answer
    }, [id, busy]);

    if (data === null || data.window <= 0) {
        return null;
    }

    const fill = Math.min(1, data.used / data.window);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-faint hover:bg-sunken aria-expanded:bg-sunken shrink-0 px-1.5 py-0.5 font-mono"
                >
                    <span>context</span>
                    <Progress
                        value={Math.round(fill * 100)}
                        tone={toneOf(fill)}
                        className="w-9"
                        aria-label="context"
                    />
                    {percent(fill)}
                </Button>
            </PopoverTrigger>
            <Popup data={data} />
        </Popover>
    );
}

export default {
    status: [{ id: "context", slot: "composer", component: Context }],
} satisfies WebExtension;
