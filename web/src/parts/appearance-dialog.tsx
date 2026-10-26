import { Palette } from "lucide-react";
import { useRef, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { Flavour } from "../lib/flavour.ts";
import { FLAVOURS, applyFlavour, currentFlavour } from "../lib/flavour.ts";

const DOTS = ["red", "yellow", "green", "pink", "blue", "mauve"] as const;

/** The icon button for the Settings footer, and the modal that picks the flavour. */
export function AppearanceButton() {
    const content = useRef<HTMLDivElement>(null);

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    type="button"
                    title="Appearance: theme"
                    aria-label="Appearance: theme"
                    className="rounded-control text-muted hover:bg-raised focus-visible:ring-accent flex size-7 items-center justify-center outline-none focus-visible:ring-2"
                >
                    <Palette className="size-4" />
                </button>
            </DialogTrigger>
            <DialogContent
                ref={content}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    content.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Appearance</DialogTitle>
                    <DialogDescription>Pick a theme. It applies at once.</DialogDescription>
                </DialogHeader>
                <FlavourGrid />
            </DialogContent>
        </Dialog>
    );
}

function FlavourGrid() {
    const [active, setActive] = useState<Flavour>(currentFlavour);

    return (
        <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
                {FLAVOURS.map((flavour) => (
                    <button
                        key={flavour}
                        type="button"
                        aria-pressed={flavour === active}
                        aria-label={flavour}
                        onClick={() => {
                            applyFlavour(flavour);
                            setActive(flavour);
                        }}
                        className={`rounded-card border-edge-soft bg-raised focus-visible:outline-ink flex flex-col gap-2 border p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${
                            flavour === active ? "ring-accent ring-2" : ""
                        }`}
                    >
                        <Preview flavour={flavour} />
                        <span className="text-interface text-ink capitalize">{flavour}</span>
                        <span data-preview={flavour} className="flex gap-1" aria-hidden="true">
                            {DOTS.map((dot) => (
                                <span
                                    key={dot}
                                    className={`size-3 rounded-full ${DOT_CLASS[dot]}`}
                                />
                            ))}
                        </span>
                    </button>
                ))}
            </div>
        </ScrollArea>
    );
}

const DOT_CLASS = {
    red: "bg-danger",
    yellow: "bg-warn",
    green: "bg-ok",
    pink: "bg-spark",
    blue: "bg-info",
    mauve: "bg-accent",
} as const satisfies Record<(typeof DOTS)[number], string>;

/** A tiny app drawn in one flavour: `data-preview` gives the element that flavour's colours. */
function Preview({ flavour }: { flavour: Flavour }) {
    return (
        <span
            data-preview={flavour}
            aria-hidden="true"
            className="rounded-control border-edge-soft bg-canvas flex h-16 gap-1 overflow-hidden border"
        >
            <span className="bg-sunken w-1/4" />
            <span className="flex flex-1 flex-col justify-center gap-1.5 p-1.5">
                <span className="bg-ink h-1 w-4/5 rounded-full" />
                <span className="bg-muted h-1 w-3/5 rounded-full" />
                <span className="bg-accent h-2 w-1/3 rounded-full" />
            </span>
        </span>
    );
}
