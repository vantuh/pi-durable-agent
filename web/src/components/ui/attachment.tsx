/**
 * shadcn's `attachment`, kept to its slots and states and recoloured with the theme's roles: one compact
 * size, a horizontal card, no `Button` or Radix `Slot` behind it.
 */

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";

export function Attachment({
    className,
    state = "done",
    ...props
}: ComponentProps<"div"> & { state?: AttachmentState }) {
    return (
        <div
            data-slot="attachment"
            data-state={state}
            className={cn(
                "group/attachment rounded-control border-edge-soft bg-raised text-ink has-[:focus-visible]:border-accent relative flex w-fit max-w-full min-w-0 shrink-0 items-center gap-1.5 border p-1 data-[state=error]:border-danger data-[state=idle]:border-dashed has-[>[data-slot=attachment-trigger]]:hover:bg-edge-soft",
                className,
            )}
            {...props}
        />
    );
}

export function AttachmentMedia({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="attachment-media"
            className={cn(
                "rounded-control bg-sunken text-muted group-data-[state=error]/attachment:text-danger relative flex size-7 shrink-0 items-center justify-center overflow-hidden *:[img]:size-full *:[img]:object-cover group-data-[state=uploading]/attachment:*:[img]:opacity-40",
                className,
            )}
            {...props}
        />
    );
}

export function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="attachment-content"
            className={cn("min-w-0 flex-1 leading-tight", className)}
            {...props}
        />
    );
}

export function AttachmentTitle({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            data-slot="attachment-title"
            className={cn(
                "text-meta block max-w-[10rem] min-w-0 truncate font-mono group-data-[state=uploading]/attachment:animate-pulse",
                className,
            )}
            {...props}
        />
    );
}

export function AttachmentDescription({ className, ...props }: ComponentProps<"span">) {
    return (
        <span
            data-slot="attachment-description"
            className={cn(
                "text-faint block min-w-0 truncate text-[11px] group-data-[state=error]/attachment:text-danger",
                className,
            )}
            {...props}
        />
    );
}

export function AttachmentActions({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="attachment-actions"
            className={cn("relative z-20 flex shrink-0 items-center", className)}
            {...props}
        />
    );
}

export function AttachmentAction({
    className,
    type = "button",
    ...props
}: ComponentProps<"button">) {
    return (
        <button
            data-slot="attachment-action"
            type={type}
            className={cn(
                "rounded-control text-muted hover:text-ink hover:bg-edge-soft flex size-5 items-center justify-center",
                className,
            )}
            {...props}
        />
    );
}

/** Makes the whole card one button. It sits under the actions, so "remove" stays separate. */
export function AttachmentTrigger({
    className,
    type = "button",
    ...props
}: ComponentProps<"button">) {
    return (
        <button
            data-slot="attachment-trigger"
            type={type}
            className={cn("absolute inset-0 z-10 cursor-zoom-in outline-none", className)}
            {...props}
        />
    );
}
