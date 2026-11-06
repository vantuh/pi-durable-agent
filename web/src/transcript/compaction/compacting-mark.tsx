import { Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

import { Rule } from "./rule.tsx";

/** A compaction that is running now, at the end of the transcript: where its marker lands once it is done. */
export function CompactingMark({ retrying }: { retrying: boolean }) {
    return (
        <div className="flex items-center gap-3">
            <Rule />
            {/* Sans, unlike the badges that hold a value: this one holds a sentence. */}
            <Badge tone={retrying ? "warn" : "raised"} className="font-sans">
                <Layers />
                {retrying ? "compaction failed, retrying" : "compacting earlier messages"}
                <Spinner />
            </Badge>
            <Rule />
        </div>
    );
}
