import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's checkbox on the theme's roles: unchecked is the sunken well of a field, checked takes the
 * accent fill, and the `Check` its `on-accent`.
 */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(
                "border-edge bg-sunken text-on-accent focus-visible:ring-accent size-4 shrink-0 border outline-none focus-visible:ring-2 disabled:opacity-50",
                "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
                "aria-invalid:border-danger aria-invalid:ring-danger/40",
                className,
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                data-slot="checkbox-indicator"
                className="grid place-content-center"
            >
                <Check className="size-3.5" />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}
