import { ChevronRight, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Markdown } from "@/ui/markdown.tsx";
import { PANE } from "@/ui/pane.tsx";

import { Rule } from "./rule.tsx";

/**
 * Where a compaction cut the context: a line, and the summary the model was handed instead of everything above it.
 * The messages above stay on screen — they are the conversation, they are just no longer what is sent.
 */
export function CompactionMark({ summary }: { summary?: string }) {
    const pill = (
        <Badge
            tone="raised"
            className={cn("font-sans", summary !== undefined && "hover:border-muted")}
        >
            <Layers />
            earlier messages were compacted
            {summary === undefined ? null : (
                <ChevronRight className="transition-transform group-data-[state=open]/fold:rotate-90" />
            )}
        </Badge>
    );

    if (summary === undefined) {
        return (
            <div className="flex items-center gap-3">
                <Rule />
                {pill}
                <Rule />
            </div>
        );
    }

    return (
        <Collapsible className="group/fold flex flex-col gap-2">
            <CollapsibleTrigger className="flex items-center gap-3 text-left">
                <Rule />
                {pill}
                <Rule />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className={`${PANE} bg-panel px-3 py-2.5`}>
                    <Markdown text={summary} />
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
