import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The line a region shows while its content is on the way: faint text, the region's own size and room.
 * The words default to "Loading…" because five sites say exactly that; one that knows what it waits for
 * says so instead.
 */
export function Loading({ className, children = "Loading…", ...props }: ComponentProps<"p">) {
    return (
        <p data-slot="loading" className={cn("text-faint", className)} {...props}>
            {children}
        </p>
    );
}
