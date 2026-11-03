import { Check } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
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
                data-slot="dropdown-menu-content"
                sideOffset={sideOffset}
                collisionPadding={8}
                className={cn(
                    "rounded-control border-edge-soft bg-panel text-ink z-50 min-w-40 border p-1 shadow-float outline-none",
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

export function DropdownMenuRadioGroup(
    props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
    return <DropdownMenuPrimitive.RadioGroup {...props} />;
}

/**
 * The mark sits in a gutter of its own, `pl-9` = the item's `px-3`, a 16px mark and the family's
 * `gap-2`, so a label with a description under it keeps the item's whole width.
 */
export function DropdownMenuRadioItem({
    className,
    children,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
    return (
        <DropdownMenuPrimitive.RadioItem
            data-slot="dropdown-menu-radio-item"
            className={cn(
                "rounded-control text-meta data-[highlighted]:bg-raised relative flex w-full cursor-default items-center gap-2 py-2 pr-3 pl-9 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <span className="absolute top-2 left-3 flex size-4 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="text-accent size-3.5" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.RadioItem>
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

export function DropdownMenuSub(props: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
    return <DropdownMenuPrimitive.Sub {...props} />;
}

export function DropdownMenuSubTrigger({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
    return (
        <DropdownMenuPrimitive.SubTrigger
            className={cn(
                "rounded-control text-meta data-[highlighted]:bg-raised data-[state=open]:bg-raised relative flex cursor-default items-center gap-2 px-3 py-2 outline-none select-none [&_svg]:size-4 [&_svg]:shrink-0",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuSubContent({
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.SubContent
                data-slot="dropdown-menu-content"
                sideOffset={4}
                collisionPadding={8}
                className={cn(
                    "rounded-control border-edge-soft bg-panel text-ink z-50 min-w-40 border p-1 shadow-float outline-none",
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}
