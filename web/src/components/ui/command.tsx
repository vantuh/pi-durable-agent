import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { EMPTY } from "./empty.tsx";

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
                    "border-edge-soft bg-sunken text-interface text-ink placeholder:text-faint focus-visible:ring-accent w-full border px-2.5 py-1.5 outline-none focus-visible:ring-2",
                    className,
                )}
                {...props}
            />
        </div>
    );
}

/** The list box. It does not scroll itself: the caller gives it a viewport, such as a `ScrollArea`. */
export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
    return <CommandPrimitive.List className={cn("w-full", className)} {...props} />;
}

/** cmdk's own empty element, which it shows and hides itself, in `Empty`'s look and the list's padding. */
export function CommandEmpty({
    className,
    ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
    return <CommandPrimitive.Empty className={cn(EMPTY, "p-2", className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
    return (
        <CommandPrimitive.Item
            className={cn(
                "hover:bg-raised/50 data-[selected=true]:bg-raised flex cursor-default items-center gap-2 px-2 py-1.5 outline-none select-none",
                className,
            )}
            {...props}
        />
    );
}
