import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

export function AlertDialogTrigger(props: ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
    return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

/**
 * The dialog's overlay and card, sized to a question: a dialog fills the screen below `sm` because it
 * holds a body, while two answers keep their margins and stay centred at every width.
 */
export function AlertDialogContent({
    className,
    children,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
    return (
        <AlertDialogPrimitive.Portal>
            <AlertDialogPrimitive.Overlay
                data-slot="alert-dialog-overlay"
                className="bg-sunken/70 fixed inset-0 z-50"
            />
            <AlertDialogPrimitive.Content
                data-slot="alert-dialog-content"
                className={cn(
                    "bg-canvas border-edge-soft text-ink fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-card border shadow-lg outline-none",
                    className,
                )}
                {...props}
            >
                {children}
            </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
    );
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-dialog-header"
            className={cn("border-edge-soft flex flex-col gap-0.5 border-b px-3 py-2.5", className)}
            {...props}
        />
    );
}

/** Cancel first: it is the first tab stop, the focus on open, and the top of the stack on a phone. */
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-dialog-footer"
            className={cn("flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:justify-end", className)}
            {...props}
        />
    );
}

export function AlertDialogTitle({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return (
        <AlertDialogPrimitive.Title
            className={cn("text-interface text-ink font-medium", className)}
            {...props}
        />
    );
}

export function AlertDialogDescription({
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
    return (
        <AlertDialogPrimitive.Description
            className={cn("text-meta text-muted", className)}
            {...props}
        />
    );
}

type AnswerProps = Omit<ComponentProps<typeof AlertDialogPrimitive.Action>, "asChild"> &
    Pick<ComponentProps<typeof Button>, "variant" | "size">;

/**
 * The destructive answer. `danger` is the default and the caller's to change, because not every
 * confirmation throws something away. A caller whose answer waits prevents the default click: the
 * question closes when it is answered, not when it is asked.
 */
export function AlertDialogAction({ variant = "danger", className, ...props }: AnswerProps) {
    return (
        <AlertDialogPrimitive.Action asChild>
            <Button variant={variant} className={className} {...props} />
        </AlertDialogPrimitive.Action>
    );
}

/** The way out: `ghost`, so the question keeps one filled button and it is not the safe one. */
export function AlertDialogCancel({ variant = "ghost", className, ...props }: AnswerProps) {
    return (
        <AlertDialogPrimitive.Cancel asChild>
            <Button variant={variant} className={className} {...props} />
        </AlertDialogPrimitive.Cancel>
    );
}
