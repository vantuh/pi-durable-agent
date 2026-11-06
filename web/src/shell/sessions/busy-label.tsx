import type { ReactNode } from "react";

import { Spinner } from "@/components/ui/spinner";

/** A busy toast's title, with the spinner at the far end: Sonner's own loading slot cannot be placed here. */
export function busyLabel(text: string): ReactNode {
    return (
        <span className="flex items-center gap-3">
            {text}
            <Spinner className="text-muted ml-auto shrink-0 motion-reduce:animate-none" />
        </span>
    );
}
