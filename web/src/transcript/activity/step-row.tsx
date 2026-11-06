import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { FolderToolIcon, FolderToolView } from "@/extensions.ts";
import { formatDuration } from "@/lib/format.ts";
import { outcomeOf, skillOf, subjectOf } from "@/lib/step-summary.ts";
import type { Step } from "@/lib/turns.ts";
import { cn } from "@/lib/utils";
import { Counts } from "@/ui/diff/counts.tsx";

import { Mark } from "./mark.tsx";
import { StepBody } from "./step-body.tsx";
import { ThoughtBody } from "./thought-body.tsx";

// Not steps: a step's line is 34px, and 13px of indent is what lands the 19px mark's centre on the rule below.
const STEP_HEAD =
    "hover:bg-raised/50 flex min-h-[34px] w-full min-w-0 items-center gap-2.5 pr-3.5 pl-[13px] text-left";

/** Under a step's line, in line with its label. 42px is the indent, the mark and the row's 10px gap. */
const STEP_BODY = "mt-1.5 mr-3.5 mb-3 ml-[42px] flex min-w-0 flex-col gap-2";

export function StepRow({
    step,
    icons,
    views,
}: {
    step: Step;
    icons: readonly FolderToolIcon[];
    views: readonly FolderToolView[];
}) {
    if (step.kind === "thinking") {
        return (
            <Collapsible>
                <CollapsibleTrigger className={STEP_HEAD}>
                    <Mark tone="thought" />
                    <span
                        className={cn(
                            "text-ink font-mono text-code font-semibold",
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

    const skill = skillOf(step);
    const subject = subjectOf(step.name, step.args);
    const outcome = outcomeOf(step);
    const took = step.result?.durationMs;

    return (
        <Collapsible>
            <CollapsibleTrigger className={STEP_HEAD}>
                <Mark
                    tone={step.status}
                    tool={skill === undefined ? step.name : "skill"}
                    icons={icons}
                />
                <span
                    className={cn(
                        "max-w-[45%] shrink-0 truncate font-mono text-code font-semibold",
                        skill === undefined ? "text-ink" : "text-warn",
                    )}
                >
                    {skill ?? step.name}
                </span>
                <span className="text-muted text-code min-w-0 flex-1 truncate font-mono">
                    {subject ?? ""}
                </span>
                {outcome === undefined ? null : (
                    <span
                        {...(took === undefined ? {} : { title: `took ${formatDuration(took)}` })}
                        className={cn(
                            "max-w-[40%] shrink-0 truncate font-mono text-meta tabular-nums",
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
                <StepBody step={step} views={views} />
            </CollapsibleContent>
        </Collapsible>
    );
}
