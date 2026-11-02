import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { lazy, type RefObject, Suspense } from "react";

import type { Props } from "./settings-content.tsx";

// The contents (and the dialogs behind their buttons) are fetched at the first open, not at boot.
const Content = lazy(async () => ({
    default: (await import("./settings-content.tsx")).SettingsContent,
}));

/** A sheet from the right edge over the app: the layout under it keeps its width. */
export function Settings({
    open,
    onClose,
    returnFocusTo,
    ...props
}: Props & { returnFocusTo: RefObject<HTMLElement | null> }) {
    return (
        <DialogPrimitive.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    data-slot="dialog-overlay"
                    className="bg-sunken/40 fixed inset-0 z-50"
                />
                <DialogPrimitive.Content
                    data-slot="sheet-content"
                    aria-describedby={undefined}
                    // The gear is outside this dialog, so Radix has no trigger to give focus back to.
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        returnFocusTo.current?.focus();
                    }}
                    className="rounded-card border-edge-soft bg-canvas fixed inset-2 z-50 flex flex-col overflow-hidden border outline-none sm:bottom-12 sm:left-auto sm:w-[360px]"
                >
                    <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2.5">
                        <DialogPrimitive.Title className="text-interface text-ink font-medium">
                            Settings
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close
                            title="Close"
                            aria-label="Close"
                            className="rounded-control text-muted hover:bg-raised focus-visible:ring-accent flex size-6 items-center justify-center outline-none focus-visible:ring-2"
                        >
                            <X className="size-4" />
                        </DialogPrimitive.Close>
                    </header>
                    <Suspense fallback={null}>
                        <Content {...props} />
                    </Suspense>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
