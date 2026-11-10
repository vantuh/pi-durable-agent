import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** One colour set per tone: the muted outline is the default, and the state tones carry their own wash. */
const TONES = {
    muted: "border-edge text-muted",
    raised: "border-edge bg-raised text-ink",
    accent: "border-accent bg-accent text-on-accent",
    info: "border-info/40 bg-info/15 text-info",
    warn: "border-warn/40 bg-warn/15 text-warn",
    danger: "border-danger/40 bg-danger/15 text-danger",
};

/** A label beside text, or a count on a control: a number in a box no wider than it needs. */
const SIZES = {
    default: "h-5 px-2",
    count: "h-3.5 min-w-3.5 justify-center px-1 leading-none",
};

type BadgeProps = ComponentProps<"span"> & {
    tone?: keyof typeof TONES;
    size?: keyof typeof SIZES;
    /** Hand the looks to the child element, so a link or a button stays one. */
    asChild?: boolean;
};

/** shadcn's badge, reduced to the tones this app uses: a small label that sits beside text. */
export function Badge({
    tone = "muted",
    size = "default",
    asChild = false,
    className,
    ...props
}: BadgeProps) {
    const classes = cn(
        "text-meta inline-flex shrink-0 items-center gap-1 border font-mono whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        SIZES[size],
        TONES[tone],
        className,
    );

    if (asChild) {
        return <Slot.Root data-slot="badge" className={classes} {...props} />;
    }

    return <span data-slot="badge" className={classes} {...props} />;
}
