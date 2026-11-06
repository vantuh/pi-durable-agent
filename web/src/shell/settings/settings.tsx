import { X } from "lucide-react";
import { lazy, type RefObject, Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Hint } from "@/components/ui/tooltip";
import { restoreComposerFocus } from "@/sdk/composer.ts";
import { PaneHeader } from "@/ui/pane.tsx";

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
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <SheetContent
                aria-describedby={undefined}
                // The caret goes back to the composer; where that is not possible (a phone, a page over it, home)
                // the gear is outside this sheet, so Radix has no trigger to give focus back to.
                onCloseAutoFocus={(event) => {
                    event.preventDefault();

                    if (!restoreComposerFocus("close")) {
                        returnFocusTo.current?.focus();
                    }
                }}
            >
                <PaneHeader>
                    <SheetTitle>Settings</SheetTitle>
                    <Hint label="Close">
                        <SheetClose asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Close">
                                <X className="size-4" />
                            </Button>
                        </SheetClose>
                    </Hint>
                </PaneHeader>
                <Suspense fallback={null}>
                    <Content {...props} />
                </Suspense>
            </SheetContent>
        </Sheet>
    );
}
