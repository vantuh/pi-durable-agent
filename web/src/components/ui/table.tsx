import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { PANE } from "../../ui/pane.tsx";

/**
 * A table, in its own scroll box: a wide one scrolls sideways inside the frame instead of widening the page,
 * which matters on a phone. `className` is the table's, as in shadcn; the frame is the primitive's.
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
    return (
        <div data-slot="table-container" className={`${PANE} overflow-x-auto`}>
            <table
                data-slot="table"
                className={cn("text-interface w-full border-collapse", className)}
                {...props}
            />
        </div>
    );
}

/**
 * The parts that carry no look of their own. The rule between rows is each cell's bottom border: the table
 * collapses its borders, so a line drawn on the row would land in the same place and stretch across the width
 * even where a row has fewer cells.
 */
export function TableHeader({ ...props }: ComponentProps<"thead">) {
    return <thead data-slot="table-header" {...props} />;
}

export function TableBody({ ...props }: ComponentProps<"tbody">) {
    return <tbody data-slot="table-body" {...props} />;
}

export function TableRow({ ...props }: ComponentProps<"tr">) {
    return <tr data-slot="table-row" {...props} />;
}

/** A column's name: the panel fill, medium ink, and the border under the header row. */
export function TableHead({ className, ...props }: ComponentProps<"th">) {
    return (
        <th
            data-slot="table-head"
            className={cn(
                "border-edge-soft bg-panel text-ink border-b px-3 py-1.5 text-left font-semibold",
                className,
            )}
            {...props}
        />
    );
}

/** A cell: top-aligned, so a long one reads down the row and not from its middle. */
export function TableCell({ className, ...props }: ComponentProps<"td">) {
    return (
        <td
            data-slot="table-cell"
            className={cn("border-edge-soft text-ink border-b px-3 py-1.5 align-top", className)}
            {...props}
        />
    );
}
