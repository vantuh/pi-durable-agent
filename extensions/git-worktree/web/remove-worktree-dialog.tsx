import { CircleAlert } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
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
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps } from "@/sdk/types.ts";

import { remove, type WorktreeState } from "../refs.ts";

/** Asks before a worktree this server made is removed, and removes it: the answer closes the question. */
export function RemoveWorktreeDialog({
    worktree,
    session,
    open,
    onOpenChange,
    onRemoved,
}: {
    worktree: WorktreeState;
    session: StatusProps["session"];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRemoved: () => void;
}) {
    const [removing, setRemoving] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!removing) {
                    onOpenChange(next);
                    setFailure(null);
                }
            }}
        >
            <AlertDialogContent>
                {/* The notice stands in for the line under the header. */}
                <AlertDialogHeader className={failure === null ? undefined : "border-b-0"}>
                    <AlertDialogTitle>Remove the worktree {worktree.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {worktree.folder} goes, with everything in it that is not committed. What is
                        committed stays on the branch {worktree.name}. The session stays too, but
                        nothing it runs will work until a folder is there again.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {failure === null ? null : (
                    <Alert className="mx-3 mb-1">
                        <CircleAlert />
                        <span className="min-w-0">{failure}</span>
                    </Alert>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={removing}>No</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={removing}
                        onClick={(event) => {
                            // The answer is the removal: the question closes once it returns.
                            event.preventDefault();
                            setRemoving(true);
                            setFailure(null);

                            void (async () => {
                                try {
                                    await callAction(
                                        remove,
                                        { cwd: session?.cwd ?? "" },
                                        session?.id ?? null,
                                    );
                                    onRemoved();
                                    onOpenChange(false);
                                } catch (error) {
                                    setFailure(
                                        error instanceof Error
                                            ? error.message
                                            : "The worktree was not removed.",
                                    );
                                } finally {
                                    setRemoving(false);
                                }
                            })();
                        }}
                    >
                        {removing ? "Removing…" : "Remove worktree"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
