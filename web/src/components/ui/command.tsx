import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's Command, after cmdk: the root handles the arrow keys, Home/End and Enter, and the input
 * names the marked row through `aria-activedescendant`. Filtering is the caller's: `shouldFilter`.
 */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
    return (
        <CommandPrimitive
            className={cn("flex min-h-0 w-full flex-1 flex-col", className)}
            {...props}
        />
    );
}

export function CommandInput({
    className,
    ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
    return (
        <div className="px-3 py-2">
            <CommandPrimitive.Input
                className={cn(
                    "rounded-control border-edge-soft bg-sunken text-interface text-ink placeholder:text-faint w-full border px-2.5 py-1.5 outline-none",
                    className,
                )}
                {...props}
            />
        </div>
    );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
    return (
        <CommandPrimitive.List
            className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto", className)}
            {...props}
        />
    );
}

export function CommandEmpty({
    className,
    ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
    return (
        <CommandPrimitive.Empty className={cn("text-faint text-meta p-2", className)} {...props} />
    );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
    return (
        <CommandPrimitive.Item
            className={cn(
                "rounded-control data-[selected=true]:bg-raised flex cursor-default items-center gap-2 px-2 py-1.5 outline-none select-none",
                className,
            )}
            {...props}
        />
    );
}
