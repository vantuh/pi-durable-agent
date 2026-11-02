import { Turtle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";

import { type Mode, set as setAction, state as stateAction } from "./refs.ts";

const RETRY_MS = 5_000;
/** Automatic tries per session: an unreachable server does not need a permanent poll. */
const ATTEMPTS = 3;

function Ponytail({ session }: StatusItemProps) {
    const [mode, setMode] = useState<Mode | null>(null);
    /** Which session the retries below were spent on; another session starts from zero. */
    const [retries, setRetries] = useState<{ session: number | null; count: number }>({
        session: null,
        count: 0,
    });
    const id = session?.id ?? null;
    /** The newest reading or toggle: an older answer arriving late is dropped, not shown. */
    const latest = useRef(0);
    /** Saves in flight: a reading that starts while one runs sees the value from before it. */
    const pending = useRef(0);
    const spent = retries.session === id ? retries.count : 0;

    const read = useCallback(async (): Promise<boolean> => {
        if (id === null) {
            return true;
        }

        const token = latest.current + 1;

        latest.current = token;

        try {
            const next = await callAction(stateAction, undefined, id);

            // Stale when a newer reading or toggle started after it, and when a save is running: the server
            // still holds the value from before that save.
            if (latest.current === token && pending.current === 0) {
                setMode(next);
            }

            return true;
        } catch {
            return false;
        }
    }, [id]);

    useEffect(() => {
        let retry: ReturnType<typeof setTimeout> | undefined;

        // One reading when the conversation opens or changes, and one per popover open: another tab runs
        // the same switch, and a session that has never answered gets a few bounded tries.
        // oxlint-disable-next-line react/set-state-in-effect -- read() sets state after its await, not during the effect
        void read().then((ok) => {
            if (ok) {
                if (spent > 0) {
                    setRetries({ session: id, count: 0 });
                }

                return undefined;
            }

            if (spent + 1 < ATTEMPTS) {
                retry = setTimeout(() => {
                    setRetries({ session: id, count: spent + 1 });
                }, RETRY_MS);
            }

            return undefined;
        });

        return () => {
            clearTimeout(retry);
        };
    }, [id, read, spent]);

    if (session === null || mode === null) {
        return null;
    }

    const toggle = (on: boolean) => {
        // A toggle outranks every reading already in flight, including the one its own save would cause.
        latest.current += 1;

        const token = latest.current;

        pending.current += 1;
        void (async () => {
            try {
                const next = await callAction(setAction, { on }, id);

                if (latest.current === token) {
                    setMode(next);
                }
            } catch {
                // A failure leaves the switch as it was.
            } finally {
                pending.current -= 1;
                // Settle on what the server stored, after a success and after a failure alike.
                await read();
            }
        })();
    };

    return (
        <Popover
            onOpenChange={(next) => {
                if (next) {
                    void read();
                }
            }}
        >
            <Hint label={`Ponytail mode: ${mode.on ? "on" : "off"}`}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Ponytail mode"
                        className={`hover:bg-sunken aria-expanded:bg-sunken shrink-0 px-1.5 py-0.5 font-mono ${
                            mode.on ? "text-ok" : "text-faint/60"
                        }`}
                    >
                        <Turtle className="size-3.5" />
                        ponytail
                    </Button>
                </PopoverTrigger>
            </Hint>
            <PopoverContent
                side="top"
                aria-label="Ponytail mode"
                className="text-meta w-64 p-3 font-mono"
            >
                <div className="flex items-center justify-between gap-3">
                    <span className="text-ink">Ponytail mode</span>
                    <Switch checked={mode.on} onCheckedChange={toggle} aria-label="Ponytail mode" />
                </div>
                <Separator className="mt-2" />
                <div className="text-faint pt-2">
                    The smallest change that works. Applies to every conversation, subagents
                    included.
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default {
    status: [{ id: "ponytail", slot: "end", component: Ponytail }],
} satisfies WebExtension;
