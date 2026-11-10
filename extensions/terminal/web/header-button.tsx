import { SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import { useShellCommand } from "@/sdk/commands.ts";
import type { HeaderItemProps } from "@/sdk/types.ts";
import { CommandKeys } from "@/ui/command-keys.tsx";

import { TERMINAL_PAGE, list } from "../refs.ts";

/** Opens the Terminal page, with the number of the folder's tabs beside the icon. */
export function TerminalButton({ session, openPage }: HeaderItemProps) {
    const id = session?.id ?? null;
    const revision = session?.revision ?? 0;
    const [count, setCount] = useState<{ id: number; tabs: number } | null>(null);

    useShellCommand("extension.terminal.open", () => {
        if (session !== null) {
            openPage(TERMINAL_PAGE);
        }
    });

    // The server bumps `revision` for every session of the folder when a tab opens, closes or exits.
    useEffect(() => {
        if (id === null) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            try {
                const found = await callAction(list, undefined, id);

                if (alive) {
                    setCount({ id, tabs: found.length });
                }
            } catch {
                // The count is a hint: the page says what went wrong when it is opened.
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-read when the server says the folder's tabs changed
    }, [id, revision]);

    if (id === null) {
        return null;
    }

    const tabs = count?.id === id ? count.tabs : 0;

    return (
        <Hint label="Terminal" keys={<CommandKeys command="extension.terminal.open" />}>
            <Button
                variant="ghost"
                size="sm"
                aria-label={`Terminal: ${String(tabs)} tabs`}
                className="relative mr-1 h-7 gap-1.5 tabular-nums"
                onClick={() => {
                    openPage(TERMINAL_PAGE);
                }}
            >
                <SquareTerminal className="size-3.5" />
                {/* The phone's header has no room for the word: the icon says it there. */}
                <span className="hidden sm:inline">Terminal</span>
                {tabs > 0 ? (
                    <Badge
                        tone="accent"
                        size="count"
                        className="pointer-events-none absolute -top-1 -right-1"
                    >
                        {tabs}
                    </Badge>
                ) : null}
            </Button>
        </Hint>
    );
}
