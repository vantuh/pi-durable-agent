import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The column an extension's details panel is: text at the details dialog's metadata size, a gap between
 * its blocks. Named after the column and not `Details`, because that is what every details module calls
 * its default export.
 */
export function DetailsColumn({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="details-column"
            className={cn("text-meta flex flex-col gap-2", className)}
            {...props}
        />
    );
}

/**
 * The line a details panel shows while it has no controls to draw — the folder is off, or it did not
 * load — where the extension says what turning it on would give. The words are the extension's.
 */
export function DetailsNote({ className, ...props }: ComponentProps<"p">) {
    return (
        <p data-slot="details-note" className={cn("text-meta text-faint", className)} {...props} />
    );
}
