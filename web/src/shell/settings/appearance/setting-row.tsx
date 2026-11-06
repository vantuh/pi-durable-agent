import type { ReactNode } from "react";

import { ToggleGroup } from "@/components/ui/toggle-group";

/** One single-choice setting of the Appearance dialog: its name and a line of help, and the choices beside them. */
export function SettingRow({
    title,
    description,
    value,
    onValueChange,
    children,
}: {
    title: string;
    description: string;
    value: string;
    onValueChange: (value: string) => void;
    /** The `ToggleGroupItem`s. */
    children: ReactNode;
}) {
    return (
        <div className="border-edge-soft flex items-center justify-between gap-3 border-t p-3">
            <div className="flex min-w-0 flex-col">
                <span className="text-interface text-ink">{title}</span>
                <span className="text-meta text-faint">{description}</span>
            </div>
            <ToggleGroup
                type="single"
                value={value}
                aria-label={title}
                onValueChange={onValueChange}
                className="bg-sunken flex shrink-0 p-0.5"
            >
                {children}
            </ToggleGroup>
        </div>
    );
}
