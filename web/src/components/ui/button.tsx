import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const VARIANTS = {
    primary: "bg-accent text-on-accent hover:bg-accent/90 font-medium",
    ghost: "text-muted hover:bg-raised hover:text-ink",
    danger: "bg-danger text-canvas hover:bg-danger/90 font-medium",
};

/**
 * The squares are the ones the hand-written icon buttons already use: 28px in a footer or a toolbar,
 * 24px inside a row.
 */
const SIZES = {
    default: "px-3 py-1.5 text-interface",
    sm: "px-2 py-1 text-meta",
    icon: "size-7",
    "icon-sm": "size-6",
};

/**
 * 8px more on every side for a fingertip, without the square growing: a bar is laid out around the box,
 * a finger is not. For a control that stands alone — two of these side by side would share a hit area,
 * so a row's own menu button, which sits inside a link, does without it.
 */
export const REACH =
    "pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']";

type ButtonProps = ComponentProps<"button"> & {
    variant?: keyof typeof VARIANTS;
    size?: keyof typeof SIZES;
    /** Hand the looks to the child element, so a link stays a link. */
    asChild?: boolean;
};

/** shadcn's button, reduced to the looks and sizes this app uses. */
export function Button({
    variant = "primary",
    size = "default",
    asChild = false,
    className,
    ...props
}: ButtonProps) {
    const classes = cn(
        // The weight is stated, not inherited: a ghost button sits inside text of every weight.
        "focus-visible:ring-accent inline-flex items-center justify-center gap-1.5 font-normal outline-none focus-visible:ring-2 disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
    );

    if (asChild) {
        return <Slot.Root data-slot="button" className={classes} {...props} />;
    }

    return <button data-slot="button" type="button" className={classes} {...props} />;
}
