import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The name of a list's group. Indented past the state mark a row keeps before its title, so a heading
 * starts over the titles and not over the marks: 24px is the row's own padding, the mark and its gap.
 */
export function GroupHeading({ className, children, ...props }: ComponentProps<"h2">) {
    return (
        <h2
            data-slot="group-heading"
            className={cn("text-faint text-meta py-1.5 pr-2 pl-6 whitespace-nowrap", className)}
            {...props}
        >
            {children}
        </h2>
    );
}
