import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps } from "react";

export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
    return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent({
    className,
    children,
    ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
    return (
        <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props}>
            <div className={className}>{children}</div>
        </CollapsiblePrimitive.Content>
    );
}
