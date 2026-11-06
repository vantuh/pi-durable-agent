import { useCallback, useRef, useState } from "react";

import { toast } from "@/lib/toast.ts";
import { useShellCommand } from "@/sdk/commands.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { busyLabel } from "./busy-label.tsx";

export function useSessionActions(
    sessions: SessionSummary[],
    current: number | null,
    onRename: (id: number, name: string) => Promise<void>,
    onArchive: (id: number, archived: boolean) => Promise<void>,
    onDelete: (id: number) => Promise<void>,
) {
    const [pending, setPending] = useState(false);
    const [deleting, setDeleting] = useState<SessionSummary | null>(null);
    const [renaming, setRenaming] = useState<number | null>(null);
    // The rename form lives in the row's popover, so a session the list draws no row for — one started
    // from another, or one the folder, archive or search filter hides — is renamed in a dialog instead,
    // and while that dialog is open no row opens its own: one form, one `#rename-session`.
    const [unanchored, setUnanchored] = useState(false);
    // The fallback has no trigger, so Radix has nothing to hand the focus back to: it remembers instead.
    const renameReturn = useRef<HTMLElement | null>(null);
    // The rows on screen, so `session.rename` can bring its row into view before opening the form.
    const rowNodes = useRef(new Map<number, HTMLDivElement>());
    const registerRow = useCallback((id: number, node: HTMLDivElement | null): void => {
        if (node === null) {
            rowNodes.current.delete(id);
        } else {
            rowNodes.current.set(id, node);
        }
    }, []);
    const startRename = useCallback((target: SessionSummary): void => {
        setUnanchored(false);
        setRenaming(target.id);
    }, []);

    useShellCommand("session.rename", () => {
        const target = sessions.find((session) => session.id === current);

        if (target !== undefined) {
            const row = rowNodes.current.get(target.id);

            row?.scrollIntoView({ block: "nearest" });
            renameReturn.current =
                row === undefined && document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
            setUnanchored(row === undefined);
            setRenaming(target.id);
        }
    });

    const saveName = useCallback(
        async (id: number, name: string): Promise<void> => {
            setPending(true);
            try {
                await onRename(id, name);
                setRenaming(null);
                toast.success("Session renamed");
            } catch {
                toast.error("Could not rename the session. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onRename],
    );
    const stopRenaming = useCallback((): void => {
        setRenaming(null);
    }, []);
    const changeArchive = useCallback(
        async (id: number, value: boolean): Promise<void> => {
            setPending(true);
            try {
                await onArchive(id, value);
                toast.success(value ? "Session archived" : "Session restored", {
                    id: `archive-${String(id)}`,
                    duration: 4000,
                    action: {
                        label: "Undo",
                        onClick: () => {
                            toast.promise(onArchive(id, !value), {
                                loading: busyLabel("Undoing…"),
                                success: value ? "Session restored" : "Session archived",
                                error: "Could not undo. Please try again.",
                            });
                        },
                    },
                });
            } catch {
                toast.error("Could not update the archive. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onArchive],
    );
    const confirmDelete = useCallback(
        async (id: number): Promise<void> => {
            setPending(true);
            try {
                await onDelete(id);
                setDeleting(null);
                toast.success("Session deleted");
            } catch {
                toast.error("Could not delete the session. Please try again.");
            } finally {
                setPending(false);
            }
        },
        [onDelete],
    );
    const cancelDelete = useCallback((): void => {
        setDeleting(null);
    }, []);

    return {
        pending,
        deleting,
        setDeleting,
        renaming,
        unanchored,
        renameReturn,
        registerRow,
        startRename,
        saveName,
        stopRenaming,
        changeArchive,
        confirmDelete,
        cancelDelete,
    };
}
