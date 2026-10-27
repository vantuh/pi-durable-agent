import { useSyncExternalStore } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";

import { diffStyle, setDiffStyle, subscribeDiffStyle } from "./preferences.ts";

export default function Details() {
    const style = useSyncExternalStore(subscribeDiffStyle, diffStyle);
    return (
        <div className="text-meta flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink">Diff layout</span>
                <Tabs
                    value={style}
                    onValueChange={(value) => {
                        if (value === "unified" || value === "split") {
                            setDiffStyle(value);
                        }
                    }}
                >
                    <TabsList aria-label="Diff layout">
                        <TabsTrigger value="unified">Unified</TabsTrigger>
                        <TabsTrigger value="split">Side by side</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
            <p className="text-faint">
                History preview only; Plannotator has its own layout setting. Saved in this browser.
            </p>
        </div>
    );
}
