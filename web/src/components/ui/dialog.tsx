import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

/** Full screen below `sm`; a centred card from `sm` up. The body scrolls, the header stays. */
export function DialogContent({
    className,
    children,
    ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
    return (
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="bg-sunken/70 fixed inset-0 z-50" />
            <DialogPrimitive.Content
                data-slot="dialog-content"
                className={cn(
                    "bg-canvas border-edge-soft text-ink fixed inset-0 z-50 flex flex-col outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[80dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border",
                    className,
                )}
                {...props}
            >
                {children}
                <DialogPrimitive.Close
                    title="Close"
                    aria-label="Close"
                    className="rounded-control text-muted hover:bg-raised focus-visible:ring-accent absolute top-2.5 right-3 flex size-6 items-center justify-center outline-none focus-visible:ring-2"
                >
                    <X className="size-4" />
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="dialog-header"
            className={cn(
                "border-edge-soft flex flex-col gap-0.5 border-b px-3 py-2.5 pr-10",
                className,
            )}
            {...props}
        />
    );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="dialog-footer"
            className={cn(
                "flex flex-col-reverse gap-2 px-3 py-2.5 sm:flex-row sm:justify-end",
                className,
            )}
            {...props}
        />
    );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            className={cn("text-interface text-ink font-medium", className)}
            {...props}
        />
    );
}

export function DialogDescription({
    className,
    ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
    return (
        <DialogPrimitive.Description className={cn("text-meta text-muted", className)} {...props} />
    );
}
