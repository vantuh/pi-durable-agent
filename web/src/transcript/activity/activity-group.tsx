import { ChevronRight, Lightbulb } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { useToolIcons, useToolViews } from "@/extensions.ts";
import { formatDuration } from "@/lib/format.ts";
import { skillOf, summarize } from "@/lib/step-summary.ts";
import type { Item } from "@/lib/turns.ts";
import { cn } from "@/lib/utils";
import { PANE } from "@/ui/pane.tsx";

import { useNow } from "../use-now.ts";
import { GroupImages } from "./group-images.tsx";
import { StepRow } from "./step-row.tsx";
import { ThoughtBody } from "./thought-body.tsx";

function Chevron() {
    return (
        <ChevronRight className="text-faint size-3.5 shrink-0 transition-transform group-data-[state=open]/fold:rotate-90" />
    );
}

/** A skill the model loaded, as the badge of a skill the person called. */
function SkillBadge({ name }: { name: string }) {
    return (
        <Badge tone="warn">
            <Lightbulb />
            {name}
        </Badge>
    );
}

/**
 * Pi's thinking and tool calls between two of its words, as one card: a line that says what they did, how many failed,
 * and how long they took. Folded by default, also while live; it opens into a timeline with one line per step.
 */
export function ActivityGroup({ item }: { item: Extract<Item, { type: "activity" }> }) {
    const now = useNow(item.live);
    const icons = useToolIcons();
    const views = useToolViews();
    const last = item.steps.at(-1);
    const thinking = item.live && last?.kind === "thinking" && last.streaming;
    const failed = item.steps.filter(
        (step) => step.kind === "tool" && step.status === "error",
    ).length;
    const until = item.live ? now : item.endedAt;
    const skills = [...new Set(item.steps.map(skillOf).filter((name) => name !== undefined))];
    const lone = item.steps.length === 1 && last?.kind === "thinking" ? last : undefined;

    return (
        <>
            <Collapsible className={`group/fold ${PANE} min-w-0 overflow-hidden`}>
                <CollapsibleTrigger className="text-ui text-muted hover:bg-raised/50 hover:text-ink group-data-[state=open]/fold:border-edge-soft flex min-h-9 w-full min-w-0 items-center gap-2.5 px-3 text-left group-data-[state=open]/fold:border-b">
                    <Chevron />
                    <span className={cn("min-w-0 flex-1 truncate", item.live && "shimmer")}>
                        {summarize(item.steps, thinking)}
                    </span>
                    {skills.map((name) => (
                        <SkillBadge key={name} name={name} />
                    ))}
                    {failed > 0 ? <Badge tone="danger">{failed} failed</Badge> : null}
                    {item.startedAt === undefined || until === undefined ? null : (
                        <span
                            className={cn(
                                "shrink-0 font-mono text-meta tabular-nums",
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
                            {/* 22px is where the marks' centres are, so the 1px rule runs through each of them. */}
                            <Separator
                                orientation="vertical"
                                className="bg-edge absolute top-5 bottom-5 left-[22px]"
                            />
                            {item.steps.map((step) => (
                                <StepRow key={step.key} step={step} icons={icons} views={views} />
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
