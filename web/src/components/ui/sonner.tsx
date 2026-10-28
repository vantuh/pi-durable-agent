import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/** One global notification host; Sonner owns animation, timers and announcements, not colours. */
export function Toaster() {
    return (
        <Sonner
            position="bottom-center"
            duration={3000}
            // The top is for session notices: below the panel headers, so none covers their buttons.
            offset={{
                top: 60,
                right: 24,
                bottom: "max(24px, env(safe-area-inset-bottom))",
                left: 24,
            }}
            mobileOffset={{
                top: "calc(60px + env(safe-area-inset-top))",
                bottom: "max(16px, env(safe-area-inset-bottom))",
                left: 16,
                right: 16,
            }}
            closeButton
            expand
            icons={{
                success: <CircleCheck className="text-ok size-4" />,
                info: <Info className="text-info size-4" />,
                warning: <TriangleAlert className="text-warn size-4" />,
                error: <CircleAlert className="text-danger size-4" />,
                // A loading toast places the spinner itself: Sonner positions this slot with CSS that
                // `unstyled` drops, which leaves the spinner floating over the text instead of at its end.
                loading: null,
                close: <X className="size-3.5" />,
            }}
            toastOptions={{
                unstyled: true,
                classNames: {
                    // The right inset belongs to the close button, which a waiting toast does not show.
                    toast: "app-toast rounded-card border-edge bg-panel text-ink text-meta flex w-full items-center gap-3 border px-4 py-3 shadow-lg has-[[data-close-button]]:pr-10",
                    title: "font-medium",
                    description: "text-muted mt-0.5",
                    content: "min-w-0 flex-1",
                    icon: "shrink-0",
                    actionButton:
                        "rounded-control bg-raised text-accent focus-visible:ring-accent shrink-0 px-2 py-1.5 font-medium outline-none focus-visible:ring-2",
                    cancelButton: "rounded-control text-muted hover:bg-raised shrink-0 px-2 py-1.5",
                    closeButton:
                        "rounded-control text-muted hover:bg-raised focus-visible:ring-accent absolute top-2 right-2 z-10 flex size-6 items-center justify-center outline-none focus-visible:ring-2",
                },
            }}
        />
    );
}
