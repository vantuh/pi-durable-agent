import { useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FLAVOURS, applyFlavour, currentFlavour, type Flavour } from "@/lib/flavour.ts";
import { PANE } from "@/ui/pane.tsx";

import { Preview } from "./preview.tsx";

const DOTS = ["red", "yellow", "green", "pink", "blue", "mauve"] as const;

export function FlavourGrid() {
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
                        className={`${PANE} bg-raised text-ink data-[state=on]:inset-ring-accent focus-visible:ring-offset-canvas flex flex-col gap-2 p-2 text-left focus-visible:ring-offset-2 data-[state=on]:inset-ring-2`}
                    >
                        <Preview flavour={flavour} />
                        <span className="text-interface text-ink capitalize">{flavour}</span>
                        <span data-preview={flavour} className="flex gap-1" aria-hidden="true">
                            {DOTS.map((dot) => (
                                <span key={dot} className={`size-3 ${DOT_CLASS[dot]}`} />
                            ))}
                        </span>
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
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
