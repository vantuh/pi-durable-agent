import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentProps, Ref } from "react";

import { cn } from "@/lib/utils";

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
    /** The element that actually scrolls — for code that reads `scrollTop` or listens to scroll. */
    viewportRef?: Ref<HTMLDivElement>;
    viewportProps?: ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
};

export function ScrollArea({
    className,
    children,
    viewportRef,
    viewportProps,
    ...props
}: ScrollAreaProps) {
    const { className: viewportClass, ...viewport } = viewportProps ?? {};

    return (
        <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
            <ScrollAreaPrimitive.Viewport
                ref={viewportRef}
                // Radix wraps the content in a `display: table` div, which breaks truncation and wrapping.
                className={cn("size-full [&>div]:!block", viewportClass)}
                {...viewport}
            >
                {children}
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
}

export function ScrollBar({
    className,
    orientation = "vertical",
    ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
    return (
        <ScrollAreaPrimitive.ScrollAreaScrollbar
            orientation={orientation}
            className={cn(
                "flex touch-none p-px transition-colors select-none",
                orientation === "vertical" && "h-full w-2 border-l border-l-transparent",
                orientation === "horizontal" && "h-2 flex-col border-t border-t-transparent",
                className,
            )}
            {...props}
        >
            <ScrollAreaPrimitive.ScrollAreaThumb className="bg-edge hover:bg-faint relative flex-1 rounded-full transition-colors" />
        </ScrollAreaPrimitive.ScrollAreaScrollbar>
    );
}
