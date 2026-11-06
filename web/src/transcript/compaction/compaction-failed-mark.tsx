import { ChevronRight, CircleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Rule } from "./rule.tsx";

/** A compaction that gave up: what came before is still what the model is sent, and the reason is worth reading. */
export function CompactionFailedMark({ error }: { error: string }) {
    return (
        <Collapsible className="group/failed flex flex-col gap-2">
            <CollapsibleTrigger className="flex items-center gap-3 text-left">
                <Rule />
                <Badge tone="danger" className="font-sans">
                    <CircleAlert />
                    compaction failed
                    <ChevronRight className="transition-transform group-data-[state=open]/failed:rotate-90" />
                </Badge>
                <Rule />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <Alert className="justify-center text-center">{error}</Alert>
            </CollapsibleContent>
        </Collapsible>
    );
}
