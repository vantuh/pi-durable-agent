import { useSyncExternalStore } from "react";

import { diffStyle, setDiffStyle, subscribeDiffStyle } from "./preferences.ts";

export default function Details() {
    const style = useSyncExternalStore(subscribeDiffStyle, diffStyle);
    return (
        <div className="text-meta flex flex-col gap-2">
            <label className="flex items-center gap-3">
                <span className="text-ink">Diff layout</span>
                <select
                    value={style}
                    onChange={(event) => {
                        const value = event.target.value;
                        if (value === "unified" || value === "split") {
                            setDiffStyle(value);
                        }
                    }}
                    className="border-edge bg-sunken text-ink rounded-control border px-2 py-1"
                >
                    <option value="unified">Unified</option>
                    <option value="split">Side by side</option>
                </select>
            </label>
            <p className="text-faint">
                History preview only; Plannotator has its own layout setting. Saved in this browser.
            </p>
        </div>
    );
}
