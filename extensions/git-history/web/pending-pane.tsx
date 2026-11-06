import type { ReactNode } from "react";

/** The page's one scroll while the diff is not drawn yet, or cannot be: the commit's own header, then a note. */
export function PendingPane({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 px-3 py-3">{header}</div>
            {children}
        </div>
    );
}
