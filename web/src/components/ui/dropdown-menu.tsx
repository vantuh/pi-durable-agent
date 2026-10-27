import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
    return <DropdownMenuPrimitive.Root {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
    return <DropdownMenuPrimitive.Trigger {...props} />;
}

export function DropdownMenuContent({
    className,
    sideOffset = 4,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                sideOffset={sideOffset}
                collisionPadding={8}
                className={cn(
                    "rounded-control border-edge-soft bg-panel text-ink z-50 min-w-40 border p-1 shadow-lg outline-none",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}

export function DropdownMenuItem({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
    return (
        <DropdownMenuPrimitive.Item
            className={cn(
                "rounded-control text-meta data-[highlighted]:bg-raised relative flex w-full cursor-default items-center gap-2 px-3 py-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuSeparator({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    return (
        <DropdownMenuPrimitive.Separator
            className={cn("bg-edge-soft -mx-1 my-1 h-px", className)}
            {...props}
        />
    );
}
