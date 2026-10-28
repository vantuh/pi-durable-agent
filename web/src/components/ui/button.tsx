import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const VARIANTS = {
    primary: "bg-accent text-on-accent hover:bg-accent/90",
    ghost: "text-muted hover:bg-raised hover:text-ink",
};

/** shadcn's button, reduced to the two looks this app uses. */
export function Button({
    variant = "primary",
    className,
    ...props
}: ComponentProps<"button"> & { variant?: keyof typeof VARIANTS }) {
    return (
        <button
            data-slot="button"
            type="button"
            className={cn(
                "rounded-control focus-visible:ring-accent text-interface inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium outline-none focus-visible:ring-2 disabled:opacity-50",
                VARIANTS[variant],
                className,
            )}
            {...props}
        />
    );
}
