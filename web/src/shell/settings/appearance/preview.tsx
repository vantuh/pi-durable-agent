import type { Flavour } from "@/lib/flavour.ts";

/** A tiny app drawn in one flavour: `data-preview` gives the element that flavour's colours. */
export function Preview({ flavour }: { flavour: Flavour }) {
    return (
        <span
            data-preview={flavour}
            aria-hidden="true"
            className="border-edge-soft bg-canvas flex h-16 gap-1 overflow-hidden border"
        >
            <span className="bg-sunken w-1/4" />
            <span className="flex flex-1 flex-col justify-center gap-1.5 p-1.5">
                <span className="bg-ink h-1 w-4/5" />
                <span className="bg-muted h-1 w-3/5" />
                <span className="bg-accent h-2 w-1/3" />
            </span>
        </span>
    );
}
