import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** shadcn's badge, outline only: a small label that sits beside text. */
export function Badge({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            data-slot="badge"
            className={cn(
                "border-edge text-meta text-muted inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
                className,
            )}
            {...props}
        />
    );
}
