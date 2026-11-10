import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const VERB = { stop: "stop", restart: "restart", remove: "close" } as const;

/** Asks before a Stop, a Restart or a tab's Close ends a program that is still running in the shell. */ export function StopDialog({
    ask,
    onCancel,
    onConfirm,
    onCloseFocus,
}: {
    ask: { what: keyof typeof VERB; process: string };
    onCancel: () => void;
    onConfirm: () => void;
    /** The dialog took the keyboard from the terminal; this gives it back. */
    onCloseFocus: () => void;
}) {
    return (
        <AlertDialog
            open
            onOpenChange={(showing) => {
                if (!showing) {
                    onCancel();
                }
            }}
        >
            <AlertDialogContent
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    onCloseFocus();
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{ask.process} is still running.</AlertDialogTitle>
                    <AlertDialogDescription>
                        {ask.what === "remove"
                            ? "Close the tab and end it anyway?"
                            : `${ask.what === "stop" ? "Stop" : "Restart"} the shell anyway?`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>No</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            event.preventDefault();
                            onConfirm();
                        }}
                    >
                        Yes, {VERB[ask.what]}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
