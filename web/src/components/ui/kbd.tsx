import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A keycap: the key that runs an action, beside the action's label. The fill is `ink`'s at a fifth,
 * so one look reads as a key on the canvas, inside a raised tooltip, and inline in text.
 */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                "bg-ink/20 text-muted text-meta rounded-control pointer-events-none inline-flex h-5 min-w-5 shrink-0 items-center justify-center px-1.5 font-mono font-medium select-none",
                className,
            )}
            {...props}
        />
    );
}

/** Keys pressed together or one after another: a modifier and its key, or a prefix and the key it arms. */
export function KbdGroup({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            data-slot="kbd-group"
            className={cn("inline-flex items-center gap-1", className)}
            {...props}
        />
    );
}
