import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Two paddings: a row in a panel is roomier than a row in a menu or a picker. */
const SIZES = {
    md: "px-2 py-2",
    sm: "px-2 py-1.5",
};

type ItemProps = ComponentProps<"div"> & {
    size?: keyof typeof SIZES;
    /** Hand the looks to the child element, so a row that is a link stays a link. */
    asChild?: boolean;
};

/**
 * shadcn's Item cut to one row: the container and the four parts the rows below the app share.
 * No fill under the pointer or while a row is open: a session row whispers, a menu row fills and a
 * queued card does not move, so each family says that itself. No font size either, since the same
 * row is 13px in a panel and 15px in a picker.
 */
export function Item({ size = "md", asChild = false, className, ...props }: ItemProps) {
    const classes = cn(
        "focus-visible:ring-accent flex items-center gap-2 outline-none focus-visible:ring-2",
        SIZES[size],
        className,
    );

    if (asChild) {
        return <Slot.Root data-slot="item" className={classes} {...props} />;
    }

    return <div data-slot="item" className={classes} {...props} />;
}

/** The row's column: the title, and the line under it. */
export function ItemContent({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="item-content"
            className={cn("flex min-w-0 flex-1 flex-col", className)}
            {...props}
        />
    );
}

export function ItemTitle({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="item-title"
            className={cn("text-sidebar text-ink truncate", className)}
            {...props}
        />
    );
}

export function ItemDescription({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="item-description"
            className={cn("text-meta text-faint truncate", className)}
            {...props}
        />
    );
}

/** The row's own controls, at its end. */
export function ItemActions({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="item-actions"
            className={cn("flex shrink-0 items-center", className)}
            {...props}
        />
    );
}
