import { useSyncExternalStore } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { DetailsColumn } from "@/ui/details.tsx";

import { applyMode, currentMode, MODE_LABELS, MODES, watchMode } from "./web/mode.ts";

export default function Details() {
    const mode = useSyncExternalStore(watchMode, currentMode);

    return (
        <DetailsColumn>
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink">Command view</span>
                <Tabs
                    value={mode}
                    onValueChange={(value) => {
                        const chosen = MODES.find((each) => each === value);

                        if (chosen !== undefined) {
                            applyMode(chosen);
                        }
                    }}
                >
                    <TabsList aria-label="Command view">
                        {MODES.map((each) => (
                            <TabsTrigger key={each} value={each}>
                                {MODE_LABELS[each]}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>
            <p className="text-faint">
                How a bash step shows its command: as written, laid out one statement and chain part
                per line, or as a row per command with its icon. Saved in this browser.
            </p>
        </DetailsColumn>
    );
}
