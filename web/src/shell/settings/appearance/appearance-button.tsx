import { Palette } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";

import { DiffLayoutPicker } from "./diff-layout-picker.tsx";
import { FlavourGrid } from "./flavour-grid.tsx";
import { WidthPicker } from "./width-picker.tsx";

/** The icon button for the Settings footer, and the modal that picks the flavour. */
export function AppearanceButton() {
    const content = useRef<HTMLDivElement>(null);

    return (
        <Dialog>
            <Hint label="Appearance: theme">
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Appearance: theme">
                        <Palette className="size-4" />
                    </Button>
                </DialogTrigger>
            </Hint>
            <DialogContent
                ref={content}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    content.current
                        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
                        ?.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Appearance</DialogTitle>
                    <DialogDescription>
                        Pick a theme, a chat width and a diff layout. They apply at once.
                    </DialogDescription>
                </DialogHeader>
                <FlavourGrid />
                <WidthPicker />
                <DiffLayoutPicker />
            </DialogContent>
        </Dialog>
    );
}
