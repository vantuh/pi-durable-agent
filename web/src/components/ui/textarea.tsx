import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's textarea on the theme's roles, at `Input`'s padding step and with its ring. No height and
 * no `field-sizing`: it is as tall as its `rows` say, and a caller that grows with its content says
 * so itself.
 */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
    return (
        <textarea
            data-slot="textarea"
            className={cn(
                "rounded-control border-edge bg-sunken text-ink text-interface placeholder:text-faint focus-visible:ring-accent w-full min-w-0 border px-2 py-1 outline-none focus-visible:ring-2 disabled:opacity-50",
                "aria-invalid:border-danger aria-invalid:ring-danger/40",
                className,
            )}
            {...props}
        />
    );
}
