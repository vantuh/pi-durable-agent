import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's separator on the theme's edges: a hairline in `edge-soft`, the colour of the borders it
 * replaces. Radix hands `decorative` through as given, so the default of `true` is stated here; a line
 * that really rules off a region passes `decorative={false}`.
 */
export function Separator({
    className,
    orientation = "horizontal",
    decorative = true,
    ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
    return (
        <SeparatorPrimitive.Root
            data-slot="separator"
            orientation={orientation}
            decorative={decorative}
            className={cn(
                "bg-edge-soft shrink-0",
                orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
                className,
            )}
            {...props}
        />
    );
}
