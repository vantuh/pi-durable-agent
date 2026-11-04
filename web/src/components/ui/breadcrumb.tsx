import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The path bar: one scroll box, and a trail inside it. */
export function Breadcrumb({ ...props }: ComponentProps<"nav">) {
    return <nav data-slot="breadcrumb" aria-label="Breadcrumb" {...props} />;
}

/**
 * The trail, on one line. shadcn wraps and breaks a long path across rows; a path is read as one
 * line here, so the box around the list scrolls sideways instead.
 */
export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
    return (
        <ol
            data-slot="breadcrumb-list"
            className={cn("flex items-center gap-1 whitespace-nowrap", className)}
            {...props}
        />
    );
}

/** One crumb. It does not shrink: the list is as wide as the whole path, and the box scrolls. */
export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
    return (
        <li
            data-slot="breadcrumb-item"
            className={cn("inline-flex shrink-0 items-center", className)}
            {...props}
        />
    );
}

type BreadcrumbLinkProps = ComponentProps<"a"> & {
    /** Hand the looks to the child element, so a crumb can be a button. */
    asChild?: boolean;
};

/** A crumb that goes somewhere: the muted text that inks on hover, and the theme's focus ring. */
export function BreadcrumbLink({
    asChild = false,
    className,
    children,
    ...props
}: BreadcrumbLinkProps) {
    const classes = cn(
        "focus-visible:ring-accent text-muted hover:text-ink outline-none focus-visible:ring-2",
        className,
    );

    if (asChild) {
        return (
            <Slot.Root data-slot="breadcrumb-link" className={classes} {...props}>
                {children}
            </Slot.Root>
        );
    }

    return (
        <a data-slot="breadcrumb-link" className={classes} {...props}>
            {children}
        </a>
    );
}

/** Where the person is: medium ink, and nothing to press, so it takes no focus. */
export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            data-slot="breadcrumb-page"
            aria-current="page"
            className={cn("text-ink font-medium", className)}
            {...props}
        />
    );
}

/** The mark between two crumbs, hidden from a screen reader: the list already says where each one is. */
export function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<"li">) {
    return (
        <li
            data-slot="breadcrumb-separator"
            aria-hidden="true"
            className={cn("text-faint shrink-0", className)}
            {...props}
        >
            {children ?? "›"}
        </li>
    );
}
