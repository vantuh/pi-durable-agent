import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                "focus-visible:ring-accent data-[state=checked]:bg-accent data-[state=unchecked]:bg-edge inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 outline-none focus-visible:ring-2 disabled:opacity-50",
                className,
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb className="bg-canvas block size-4 rounded-full transition-transform data-[state=checked]:translate-x-4" />
        </SwitchPrimitive.Root>
    );
}
