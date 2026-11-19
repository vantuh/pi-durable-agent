import { useCallback, useState } from "react";

import type { FolderFolderMenuItem, FolderSessionMenuItem } from "@/extensions.ts";
import { toast } from "@/lib/toast.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { busyLabel } from "./busy-label.tsx";
import { labelOf, runKey } from "./menu-item.ts";

/** Runs an extension's menu item in a toast; `onOpenPage` is what its `openPage` calls, by page key. */
export function useMenuRunner(onOpenPage: (session: number, key: string, sub?: string) => void) {
    const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
    /** The toast and the page the item's `run` may open, for one session; `done` runs when it settles. */
    const runFor = useCallback(
        (
            item: FolderSessionMenuItem | FolderFolderMenuItem,
            run: NonNullable<FolderSessionMenuItem["run"]>,
            session: number,
            label: string,
            done?: () => void,
        ): void => {
            toast.promise(
                run(session, (page, sub) => {
                    onOpenPage(session, `${item.folder}:${page}`, sub);
                }),
                {
                    loading: busyLabel(`${label}…`),
                    error: (error: unknown) =>
                        error instanceof Error ? error.message : "Could not finish the action.",
                    finally: () => {
                        done?.();
                    },
                },
            );
        },
        [onOpenPage],
    );
    const runMenuItem = useCallback(
        (item: FolderSessionMenuItem, session: SessionSummary): void => {
            const run = item.run;
            if (run === undefined) {
                return;
            }

            const key = runKey(item, session);
            const markRunning = (on: boolean): void => {
                setRunning((keys) => {
                    const next = new Set(keys);
                    if (on) {
                        next.add(key);
                    } else {
                        next.delete(key);
                    }

                    return next;
                });
            };

            markRunning(true);
            runFor(item, run, session.id, labelOf(item, session), () => {
                markRunning(false);
            });
        },
        [runFor],
    );
    const runFolderItem = useCallback(
        (item: FolderFolderMenuItem, session: number): void => {
            runFor(item, item.run, session, item.label);
        },
        [runFor],
    );

    return { running, runMenuItem, runFolderItem };
}
