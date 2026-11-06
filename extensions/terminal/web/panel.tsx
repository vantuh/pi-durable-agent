import { useState } from "react";

import { Empty } from "@/components/ui/empty";
import type { PanelProps } from "@/sdk/types.ts";

import { Shell } from "./shell.tsx";

export function TerminalPanel({ session, expanded }: PanelProps) {
    const id = session?.id ?? null;
    // A new shell is a new terminal: the effect starts again instead of reusing what the old one fitted.
    const [generation, setGeneration] = useState(0);

    if (id === null) {
        return <Empty className="text-interface p-3">Open a session to use the terminal.</Empty>;
    }

    return (
        <Shell
            key={generation}
            id={id}
            expanded={expanded}
            onRestart={() => {
                setGeneration((value) => value + 1);
            }}
        />
    );
}
