import { useCallback, useState } from "react";

import type { FolderSessionMenuItem } from "@/extensions.ts";
import { toast } from "@/lib/toast.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { busyLabel } from "./busy-label.tsx";
import { labelOf, runKey } from "./menu-item.ts";

export function useMenuRunner() {
    const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
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
            toast.promise(run(session.id), {
                loading: busyLabel(`${labelOf(item, session)}…`),
                error: (error: unknown) =>
                    error instanceof Error ? error.message : "Could not finish the action.",
                finally: () => {
                    markRunning(false);
                },
            });
        },
        [],
    );

    return { running, runMenuItem };
}
