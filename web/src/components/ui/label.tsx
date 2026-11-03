import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Radix's label, which refuses to select its text on a second click, at the size and colour every
 * form label in the app reads at.
 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
    return (
        <LabelPrimitive.Root
            data-slot="label"
            className={cn("text-meta text-muted", className)}
            {...props}
        />
    );
}
