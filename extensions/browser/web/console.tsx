import { useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { callAction } from "@/sdk/actions.ts";

import { type LogEntry, logs } from "../refs.ts";

export function Console({ id, count }: { id: number | null; count: number }) {
    const [lines, setLines] = useState<LogEntry[]>([]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const next = await callAction(logs, undefined, id).catch(() => []);

            if (alive) {
                setLines(next);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `count` grows with every console line: it is the trigger to read them again
    }, [id, count]);

    return (
        <ScrollArea
            className="border-edge-soft shrink-0 border-t"
            viewportProps={{ className: "max-h-40" }}
        >
            <div className="text-meta p-2 font-mono">
                {lines.length === 0 ? (
                    <span className="text-faint">The console is empty.</span>
                ) : null}
                {lines.map((line) => (
                    <div
                        key={line.seq}
                        className={
                            line.level === "error"
                                ? "text-danger"
                                : line.level === "warning"
                                  ? "text-warn"
                                  : "text-muted"
                        }
                    >
                        {line.level === "nav" ? `— ${line.text}` : line.text}
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
