import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's toggle group, kept as generic as Radix's: `type="single"` renders `role="radiogroup"` with
 * `role="radio"` items, `type="multiple"` a `role="toolbar"`. Since a single group lets its pressed
 * item be pressed off again, a caller that must always have one value ignores the empty one.
 *
 * The row and its spacing belong to the caller: two of the three groups are a segmented row and the
 * third a grid of cards, so only the items share a look.
 */
export function ToggleGroup({
    className,
    ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
    return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={className} {...props} />;
}

/**
 * The pressed item wears the raised fill and the ink of any other pressed control, the rest stay
 * muted. Radius, text size and the focus ring are the theme's; the padding, the layout, and whatever
 * a group says about its own state (a card's ring) are the caller's className.
 */
export function ToggleGroupItem({
    className,
    ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
    return (
        <ToggleGroupPrimitive.Item
            data-slot="toggle-group-item"
            className={cn(
                "text-interface text-muted focus-visible:ring-accent data-[state=on]:bg-raised data-[state=on]:text-ink outline-none focus-visible:ring-2",
                className,
            )}
            {...props}
        />
    );
}
