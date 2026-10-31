import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="skeleton"
            className={cn(
                "bg-raised animate-pulse rounded-control motion-reduce:animate-none",
                className,
            )}
            {...props}
        />
    );
}
