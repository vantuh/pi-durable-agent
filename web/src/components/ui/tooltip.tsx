import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One provider at the root, so the delay is learned once: the first tooltip waits, moving to a
 * neighbouring trigger shows at once (`skipDelayDuration`).
 */
export function TooltipProvider({
    delayDuration = 300,
    ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
    return (
        <TooltipPrimitive.Provider
            data-slot="tooltip-provider"
            delayDuration={delayDuration}
            {...props}
        />
    );
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

/**
 * No `data-slot`: as a child trigger it would overwrite the slot of the element it wraps.
 * Focus opens the tooltip only when it is keyboard focus: a dialog's autofocus, or focus returned
 * to a trigger after a click, would otherwise pop a hint nobody asked for.
 */
export function TooltipTrigger({
    onFocus,
    ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
    return (
        <TooltipPrimitive.Trigger
            onFocus={(event) => {
                onFocus?.(event);
                if (!event.currentTarget.matches(":focus-visible")) {
                    event.preventDefault();
                }
            }}
            {...props}
        />
    );
}

export function TooltipContent({
    className,
    sideOffset = 4,
    ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                collisionPadding={8}
                className={cn(
                    "rounded-control border-edge bg-raised text-ink text-meta z-50 max-w-xs border px-2 py-1 shadow-lg outline-none",
                    className,
                )}
                {...props}
            />
        </TooltipPrimitive.Portal>
    );
}

/** A trigger and its label in one element, so a call site adds a hint instead of three tooltip parts. */
export function Hint({
    label,
    side,
    children,
}: {
    label: ReactNode;
    side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side={side}>{label}</TooltipContent>
        </Tooltip>
    );
}
