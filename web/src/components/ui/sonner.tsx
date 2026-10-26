import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/** One global notification host; Sonner owns animation, timers and announcements, not colours. */
export function Toaster() {
    return (
        <Sonner
            position="bottom-center"
            duration={3000}
            offset="max(24px, env(safe-area-inset-bottom))"
            mobileOffset={{ bottom: "max(16px, env(safe-area-inset-bottom))", left: 16, right: 16 }}
            closeButton
            expand
            icons={{
                success: <CircleCheck className="text-ok size-4" />,
                info: <Info className="text-info size-4" />,
                warning: <TriangleAlert className="text-warn size-4" />,
                error: <CircleAlert className="text-danger size-4" />,
                loading: (
                    <LoaderCircle className="text-muted size-4 animate-spin motion-reduce:animate-none" />
                ),
                close: <X className="size-3.5" />,
            }}
            toastOptions={{
                unstyled: true,
                classNames: {
                    toast: "app-toast rounded-card border-edge bg-panel text-ink text-meta flex w-full items-center gap-3 border py-3 pr-10 pl-4 shadow-lg",
                    title: "font-medium",
                    description: "text-muted mt-0.5",
                    content: "min-w-0 flex-1",
                    icon: "shrink-0",
                    actionButton:
                        "rounded-control bg-raised text-accent focus-visible:ring-accent shrink-0 px-2 py-1.5 font-medium outline-none focus-visible:ring-2",
                    cancelButton: "rounded-control text-muted hover:bg-raised shrink-0 px-2 py-1.5",
                    closeButton:
                        "rounded-control text-muted hover:bg-raised focus-visible:ring-accent absolute top-2 right-2 flex size-6 items-center justify-center outline-none focus-visible:ring-2",
                },
            }}
        />
    );
}
