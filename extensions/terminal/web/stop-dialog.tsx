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

/** Asks before a Stop or a Restart ends a program that is still running in the shell. */
export function StopDialog({
    ask,
    onCancel,
    onConfirm,
    onCloseFocus,
}: {
    ask: { what: "stop" | "restart"; process: string };
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
                        {ask.what === "stop"
                            ? "Stop the shell anyway?"
                            : "Restart the shell anyway?"}
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
                        Yes, {ask.what === "stop" ? "stop" : "restart"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
