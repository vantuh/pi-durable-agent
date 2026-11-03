import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

/** A close where the caller wants it: the sheet draws no button of its own. */
export function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
    return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * The edge a sheet comes from, with the geometry of an edge panel: the whole screen below
 * `sm`, and from `sm` up a 360px column that covers the status bar too. A side is added
 * when a caller slides in from it; today only the right edge has one.
 */
const SIDES = {
    right: "inset-0 sm:left-auto sm:w-[360px]",
};

type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
    side?: keyof typeof SIDES;
};

export function SheetContent({ side = "right", className, children, ...props }: SheetContentProps) {
    return (
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
                data-slot="dialog-overlay"
                className="bg-sunken/70 fixed inset-0 z-50"
            />
            <DialogPrimitive.Content
                data-slot="sheet-content"
                className={cn(
                    "border-edge-soft bg-panel fixed z-50 flex flex-col overflow-hidden border-l outline-none",
                    SIDES[side],
                    className,
                )}
                {...props}
            >
                {children}
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            className={cn("text-interface text-ink font-medium", className)}
            {...props}
        />
    );
}
