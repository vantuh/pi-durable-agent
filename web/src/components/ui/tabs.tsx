import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
    return <TabsPrimitive.Root className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
    return (
        <TabsPrimitive.List
            className={cn(
                "rounded-control bg-sunken text-muted inline-flex items-center gap-0.5 p-0.5",
                className,
            )}
            {...props}
        />
    );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            className={cn(
                "rounded-control text-interface hover:text-ink data-[state=active]:bg-raised data-[state=active]:text-ink inline-flex flex-1 items-center justify-center px-2 py-1 whitespace-nowrap outline-none",
                className,
            )}
            {...props}
        />
    );
}
