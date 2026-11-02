import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's Empty cut to the one part every caller has: the line a region shows instead of content.
 * No media, title, description or content slot: each site is one sentence, and the one that offers an
 * action beside it lays out its own column. The size, padding and room are the caller's.
 */
export function Empty({ className, ...props }: ComponentProps<"div">) {
    return <div data-slot="empty" className={cn("text-meta text-faint", className)} {...props} />;
}
