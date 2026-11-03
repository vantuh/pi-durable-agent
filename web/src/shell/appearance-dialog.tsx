import { Palette } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Hint } from "@/components/ui/tooltip";

import type { DiffLayout } from "../lib/diff-layout.ts";
import { DIFF_LAYOUTS, applyDiffLayout, currentDiffLayout } from "../lib/diff-layout.ts";
import type { Flavour } from "../lib/flavour.ts";
import { FLAVOURS, applyFlavour, currentFlavour } from "../lib/flavour.ts";
import type { Width } from "../lib/width.ts";
import { WIDTH_NAMES, applyWidth, currentWidth } from "../lib/width.ts";

const DOTS = ["red", "yellow", "green", "pink", "blue", "mauve"] as const;

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

function FlavourGrid() {
    const [active, setActive] = useState<Flavour>(currentFlavour);

    return (
        <ScrollArea className="min-h-0 flex-1">
            <ToggleGroup
                type="single"
                value={active}
                aria-label="Theme"
                onValueChange={(value) => {
                    // A single group lets its pressed item be pressed off; a flavour always stays chosen.
                    const flavour = FLAVOURS.find((name) => name === value);

                    if (flavour === undefined) {
                        return;
                    }

                    applyFlavour(flavour);
                    setActive(flavour);
                }}
                className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4"
            >
                {FLAVOURS.map((flavour) => (
                    // A chosen card wears an accent ring inside its own border; focus draws the theme's ring
                    // 2px outside it. Two rings on different properties, so a card reads as chosen and as
                    // focused at once, and neither state can hide the other.
                    <ToggleGroupItem
                        key={flavour}
                        value={flavour}
                        aria-label={flavour}
                        className="bg-raised border-edge-soft rounded-card text-ink data-[state=on]:inset-ring-accent focus-visible:ring-offset-canvas flex flex-col gap-2 border p-2 text-left focus-visible:ring-offset-2 data-[state=on]:inset-ring-2"
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
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </ScrollArea>
    );
}

function WidthPicker() {
    const [active, setActive] = useState<Width>(currentWidth);

    return (
        <div className="border-edge-soft flex items-center justify-between gap-3 border-t p-3">
            <div className="flex min-w-0 flex-col">
                <span className="text-interface text-ink">Width</span>
                <span className="text-meta text-faint">
                    Wide screens: how much room the conversation takes.
                </span>
            </div>
            <ToggleGroup
                type="single"
                value={active}
                aria-label="Width"
                onValueChange={(value) => {
                    // A single group lets its pressed item be pressed off; a width always stays chosen.
                    const width = WIDTH_NAMES.find((name) => name === value);

                    if (width === undefined) {
                        return;
                    }

                    applyWidth(width);
                    setActive(width);
                }}
                className="rounded-control bg-sunken flex shrink-0 p-0.5"
            >
                {WIDTH_NAMES.map((width) => (
                    <ToggleGroupItem key={width} value={width} className="px-2 py-1 capitalize">
                        {width}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}

function DiffLayoutPicker() {
    const [active, setActive] = useState<DiffLayout>(currentDiffLayout);

    return (
        <div className="border-edge-soft flex items-center justify-between gap-3 border-t p-3">
            <div className="flex min-w-0 flex-col">
                <span className="text-interface text-ink">Diffs</span>
                <span className="text-meta text-faint">
                    An edit's changes: one column, or the old file beside the new.
                </span>
            </div>
            <ToggleGroup
                type="single"
                value={active}
                aria-label="Diffs"
                onValueChange={(value) => {
                    // A single group lets its pressed item be pressed off; a layout always stays chosen.
                    const layout = DIFF_LAYOUTS.find((name) => name === value);

                    if (layout === undefined) {
                        return;
                    }

                    applyDiffLayout(layout);
                    setActive(layout);
                }}
                className="rounded-control bg-sunken flex shrink-0 p-0.5"
            >
                {DIFF_LAYOUTS.map((layout) => (
                    <ToggleGroupItem key={layout} value={layout} className="px-2 py-1">
                        {layout === "split" ? "Side by side" : "Unified"}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
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
