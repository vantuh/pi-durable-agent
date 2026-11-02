import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { type ComponentProps, useCallback } from "react";

export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
    return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

/** A fold taller than this many screens crosses its distance in a few frames, too fast to read as movement. */
const READABLE_SCREENS = 1.5;

export function CollapsibleContent({
    className,
    children,
    ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
    // Radix renders the body only while the fold is open, so this runs as it opens, before the first frame; the fold
    // that is too tall for its 150ms is then faded instead, by the rule this attribute selects in styles.css.
    const measure = useCallback((body: HTMLDivElement | null) => {
        if (body === null) {
            return;
        }

        body.parentElement?.toggleAttribute(
            "data-beyond",
            body.scrollHeight > window.innerHeight * READABLE_SCREENS,
        );
    }, []);

    return (
        <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props}>
            <div ref={measure} className={className}>
                {children}
            </div>
        </CollapsiblePrimitive.Content>
    );
}
