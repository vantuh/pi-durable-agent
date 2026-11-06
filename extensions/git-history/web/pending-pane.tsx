import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area.tsx";

/** The page's one scroll while the diff is not drawn yet, or cannot be: the commit's own header, then a note. */
export function PendingPane({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <ScrollArea type="always" className="min-h-0 flex-1">
            <div className="flex flex-col gap-3 px-3 py-3">{header}</div>
            {children}
        </ScrollArea>
    );
}
