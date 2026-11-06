import { useSyncExternalStore } from "react";

import { ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    DIFF_LAYOUTS,
    applyDiffLayout,
    currentDiffLayout,
    watchDiffLayout,
} from "@/lib/diff-layout.ts";

import { SettingRow } from "./setting-row.tsx";

export function DiffLayoutPicker() {
    const active = useSyncExternalStore(watchDiffLayout, currentDiffLayout);

    return (
        <SettingRow
            title="Diffs"
            description="Tool edits and diff previews: one column, or the old file beside the new."
            value={active}
            onValueChange={(value) => {
                // A single group lets its pressed item be pressed off; a layout always stays chosen.
                const layout = DIFF_LAYOUTS.find((name) => name === value);

                if (layout === undefined) {
                    return;
                }

                applyDiffLayout(layout);
            }}
        >
            {DIFF_LAYOUTS.map((layout) => (
                <ToggleGroupItem key={layout} value={layout} className="px-2 py-1">
                    {layout === "split" ? "Side by side" : "Unified"}
                </ToggleGroupItem>
            ))}
        </SettingRow>
    );
}
