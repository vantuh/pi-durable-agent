import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's input on the theme's roles. `aria-invalid` is the state, not a prop: it takes the border
 * and the ring, after the focus ring, so a field that is wrong reads as wrong while it is focused.
 */
export function Input({ className, type, ...props }: ComponentProps<"input">) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                "border-edge bg-sunken text-ink text-interface placeholder:text-faint focus-visible:ring-accent h-8 w-full min-w-0 border px-2 py-1 outline-none focus-visible:ring-2 disabled:opacity-50",
                "aria-invalid:border-danger aria-invalid:ring-danger/40",
                className,
            )}
            {...props}
        />
    );
}
