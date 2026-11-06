import { useMemo, useSyncExternalStore } from "react";

import { CodeBlock } from "@/ui/markdown/code-block.tsx";

import { layout, split } from "./layout.ts";
import { currentMode, watchMode } from "./mode.ts";
import { Panels } from "./panels.tsx";

/** A bash call's command as written, laid out, or as panels, as the Extensions dialog chose for every step. */
export function BashView({ command }: { command: string }) {
    const mode = useSyncExternalStore(watchMode, currentMode);
    const parts = useMemo(() => (mode === "panels" ? split(command) : undefined), [command, mode]);

    return parts !== undefined ? (
        <Panels source={command} parts={parts} />
    ) : (
        <CodeBlock code={mode === "raw" ? command : layout(command)} lang="bash" />
    );
}
