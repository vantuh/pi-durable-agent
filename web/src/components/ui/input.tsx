import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A text field. `aria-invalid` is what marks it wrong: the border and the ring turn red, so the field
 * says it by itself, and no role is needed for the state.
 */
export function Input({ className, type, ...props }: ComponentProps<"input">) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                "rounded-control border-edge bg-sunken text-ink text-interface placeholder:text-faint focus-visible:ring-accent h-8 w-full min-w-0 border px-2 py-1 outline-none focus-visible:ring-2 disabled:opacity-50",
                "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger",
                className,
            )}
            {...props}
        />
    );
}
