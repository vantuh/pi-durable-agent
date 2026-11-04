import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Two tones, each with a caller: a failure in red, a provider's warning in yellow. */
const TONES = {
    danger: "bg-danger/10 text-danger",
    warn: "bg-warn/10 text-warn",
};

type AlertProps = ComponentProps<"div"> & {
    tone?: keyof typeof TONES;
};

/**
 * shadcn's alert on the theme's roles: a wash and an optional leading icon that inherits the tone's colour.
 * The default `role="alert"` is for a failure the person should notice now; a passive note passes
 * `role="status"` so it is announced without interrupting.
 */
export function Alert({ tone = "danger", role = "alert", className, ...props }: AlertProps) {
    return (
        <div
            data-slot="alert"
            role={role}
            className={cn(
                "text-meta flex items-start gap-2 px-3 py-2 break-words [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0",
                TONES[tone],
                className,
            )}
            {...props}
        />
    );
}
