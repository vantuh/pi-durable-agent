import { useState } from "react";

import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { WIDTH_NAMES, applyWidth, currentWidth, type Width } from "@/lib/width.ts";

import { SettingRow } from "./setting-row.tsx";

export function WidthPicker() {
    const [active, setActive] = useState<Width>(currentWidth);

    return (
        <SettingRow
            title="Width"
            description="Wide screens: how much room the conversation takes."
            value={active}
            onValueChange={(value) => {
                // A single group lets its pressed item be pressed off; a width always stays chosen.
                const width = WIDTH_NAMES.find((name) => name === value);

                if (width === undefined) {
                    return;
                }

                applyWidth(width);
                setActive(width);
            }}
        >
            {WIDTH_NAMES.map((width) => (
                <ToggleGroupItem key={width} value={width} className="px-2 py-1 capitalize">
                    {width}
                </ToggleGroupItem>
            ))}
        </SettingRow>
    );
}
