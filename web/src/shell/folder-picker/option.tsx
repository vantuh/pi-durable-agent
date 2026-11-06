import { useCallback } from "react";

import type { FolderNewSessionItem } from "@/extensions.ts";
import type { NewSessionCollected } from "@/sdk/types.ts";

/** One extension's option in the footer, given a `use` that holds still while the dialog renders. */
export function Option({
    option,
    cwd,
    refused,
    onUse,
}: {
    option: FolderNewSessionItem;
    cwd: string | null;
    refused: string | null;
    onUse: (id: string, collected: NewSessionCollected | null) => void;
}) {
    const { id, component: Component } = option;
    const use = useCallback(
        (collected: NewSessionCollected | null) => {
            onUse(id, collected);
        },
        [id, onUse],
    );

    return <Component cwd={cwd} use={use} refused={refused} />;
}
