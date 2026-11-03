import type { ComponentProps } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const ORIENTATIONS = {
    vertical: "flex-col gap-1",
    horizontal: "flex-row items-center gap-2",
};

type FieldProps = ComponentProps<"div"> & {
    /** A label over its control, or a checkbox beside its label. */
    orientation?: keyof typeof ORIENTATIONS;
};

/**
 * A label and its control. The caller writes the `id` on the control and names it in the label's
 * `htmlFor`: a field here is one control, so nothing has to reach into the children to find it.
 */
export function Field({ orientation = "vertical", className, ...props }: FieldProps) {
    return (
        <div
            data-slot="field"
            className={cn("flex", ORIENTATIONS[orientation], className)}
            {...props}
        />
    );
}

/** The hint under a control: give it an `id` and put that id in the control's `aria-describedby`. */
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
    return (
        <p
            data-slot="field-description"
            className={cn("text-meta text-muted", className)}
            {...props}
        />
    );
}

/**
 * A failure under a control, as `Alert`: give it an `id`, name it in the control's
 * `aria-describedby`, and set `aria-invalid` on the control while it shows.
 */
export function FieldError(props: ComponentProps<typeof Alert>) {
    return <Alert data-slot="field-error" {...props} />;
}
