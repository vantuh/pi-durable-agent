import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { useBooleanAction } from "@/sdk/boolean-action.ts";
import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";

import { set as setAction, state as stateAction } from "./refs.ts";
import { Unicorn } from "./web/icon.tsx";

function Ponytail({ session }: StatusItemProps) {
    const { mode, read, toggle } = useBooleanAction(session?.id ?? null, stateAction, setAction);

    if (session === null || mode === null) {
        return null;
    }

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
                        <Unicorn className="size-3.5" />
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
    // Ahead of the bar's other items, beside its sibling: the two voices read as one pair.
    status: [{ id: "ponytail", slot: "end", order: -1, component: Ponytail }],
} satisfies WebExtension;
