import type { RefObject } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { focusComposer } from "@/sdk/composer.ts";

import { RenameForm } from "./rename-form.tsx";

/** For a session the list draws no row for, so there is no popover to hold the form. */
export function RenameDialog({
    id,
    name,
    pending,
    returnTo,
    onSave,
    onCancel,
}: {
    id: number;
    name: string;
    pending: boolean;
    /** What held the focus before the dialog opened, which takes it back. */
    returnTo: RefObject<HTMLElement | null>;
    onSave: (id: number, name: string) => Promise<void>;
    onCancel: () => void;
}) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onCancel();
                }
            }}
        >
            <DialogContent
                aria-describedby={undefined}
                className="bg-panel text-meta sm:max-w-sm"
                onCloseAutoFocus={(event) => {
                    event.preventDefault();

                    const back = returnTo.current;

                    if (back !== null && back.isConnected) {
                        back.focus();

                        return;
                    }

                    // What held it is gone: the composer takes the caret when there is one.
                    focusComposer();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Rename session</DialogTitle>
                </DialogHeader>
                <div className="p-3">
                    <RenameForm
                        id={id}
                        name={name}
                        pending={pending}
                        onSave={onSave}
                        onCancel={onCancel}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
