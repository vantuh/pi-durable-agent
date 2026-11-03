import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
    return <PopoverPrimitive.Root {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
    return <PopoverPrimitive.Trigger {...props} />;
}

/** An anchor that is not the trigger, for a popup its own row's menu item opens. */
export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
    return <PopoverPrimitive.Anchor {...props} />;
}

/**
 * The two frames a popup comes in: a menu of rows at its own 4px, and a panel of content with room
 * around it. A caller whose width differs states it beside the size, and `cn` lets it win.
 */
const SIZES = {
    menu: "w-72 p-1",
    panel: "w-64 p-3",
};

type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content> & {
    size?: keyof typeof SIZES;
};

/**
 * A dropdown menu's surface with room for anything: the frame and the two sizes are the primitive's,
 * the text size, the scrolling and the room a size does not name are the caller's, because a popup
 * holds prose, rows or a form and each one measures differently. Radix flips and shifts it inside the
 * viewport, and closes it on an outside click and on Escape. Opening moves focus into the content, so
 * Escape has somewhere to return it: the trigger. An outside click does not take the focus back,
 * because it already put it where the person clicked.
 */
export function PopoverContent({ className, size, sideOffset = 4, ...props }: PopoverContentProps) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                data-slot="popover-content"
                sideOffset={sideOffset}
                collisionPadding={8}
                className={cn(
                    "border-edge-soft bg-panel text-ink z-50 border shadow-float outline-none",
                    size === undefined ? undefined : SIZES[size],
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}
