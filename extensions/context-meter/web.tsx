import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { type Breakdown, breakdown, type Part } from "./refs.ts";

const WARN_ABOVE = 0.7;
const DANGER_ABOVE = 0.9;
const POPUP_WIDTH = 640;
const GAP = 8;
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

function toneOf(fill: number): string {
    return fill > DANGER_ABOVE ? "bg-danger" : fill > WARN_ABOVE ? "bg-warn" : "bg-accent";
}

function Bar({ fill, className }: { fill: number; className: string }) {
    return (
        <span className="bg-raised flex h-1 overflow-hidden rounded-full" aria-hidden>
            <span className={className} style={{ width: percent(Math.min(1, fill)) }} />
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
            <Bar fill={part.tokens / biggest} className="bg-accent" />
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
                <span className="bg-accent size-2.5 self-center rounded-sm" />
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

function Popup({ data, left, bottom }: { data: Breakdown; left: number; bottom: number }) {
    const fill = data.window > 0 ? data.used / data.window : 0;

    return (
        <div
            style={{ left, bottom, width: `min(${String(POPUP_WIDTH)}px, calc(100vw - 1rem))` }}
            className="fixed z-50 pb-2"
        >
            <div className="rounded-card border-edge-soft bg-canvas border font-mono shadow-lg">
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
                                        <span className="w-32">
                                            <Bar fill={fill} className={toneOf(fill)} />
                                        </span>
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
            </div>
        </div>
    );
}

function Context({ session }: StatusProps) {
    const [data, setData] = useState<Breakdown | null>(null);
    const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
    const trigger = useRef<HTMLSpanElement>(null);
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

    const open = () => {
        const rect = trigger.current?.getBoundingClientRect();

        if (rect === undefined) {
            return;
        }

        const width = Math.min(POPUP_WIDTH, window.innerWidth - 2 * GAP);
        const centered = rect.left + rect.width / 2 - width / 2;

        setAt({
            left: Math.max(GAP, Math.min(centered, window.innerWidth - width - GAP)),
            bottom: window.innerHeight - rect.top,
        });
    };

    return (
        <span
            ref={trigger}
            onMouseEnter={open}
            onMouseLeave={() => {
                setAt(null);
            }}
            className="flex shrink-0"
        >
            <button
                type="button"
                onFocus={open}
                onBlur={() => {
                    setAt(null);
                }}
                onClick={open}
                aria-expanded={at !== null}
                className="text-faint hover:text-ink hover:bg-sunken aria-expanded:bg-sunken flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono"
            >
                <span>context</span>
                <span className="w-9">
                    <Bar fill={fill} className={toneOf(fill)} />
                </span>
                {percent(fill)}
            </button>
            {at === null ? null : <Popup data={data} left={at.left} bottom={at.bottom} />}
        </span>
    );
}

export default {
    status: [{ id: "context", slot: "composer", component: Context }],
} satisfies WebExtension;
