import { useEffect, useState } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import { runCommand } from "@/sdk/commands.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { DEFAULT_KEYMAP, fieldKeeps, step, type Keymap } from "./lib.ts";
import { keymap } from "./refs.ts";

const ARMED_MS = 1500;

/** `ctrl+a` as the caps it is: one per key, in the order it is pressed, a repeated modifier once. */
function caps(prefix: string): string[] {
    return [...new Set(prefix.split("+"))];
}

function Hotkeys() {
    const [label, setLabel] = useState<string | null>(null);

    useEffect(() => {
        let map: Keymap | null = null;
        let armed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let alive = true;

        const arm = (value: boolean): void => {
            armed = value;
            clearTimeout(timer);
            setLabel(value ? (map?.prefix ?? null) : null);

            if (value) {
                timer = setTimeout(() => {
                    arm(false);
                }, ARMED_MS);
            }
        };

        const onKey = (event: KeyboardEvent): void => {
            const focus = document.activeElement;
            const target = event.target instanceof HTMLElement ? event.target : null;

            if (map === null || event.isComposing) {
                return;
            }

            // A dialog owns the keyboard; a field keeps what it types but not the prefix, which has to
            // reach `step` so the shell arms from anywhere. Only a prefix already pressed carries on.
            const dialog = focus !== null && focus.closest('[role="dialog"]') !== null;
            if (!armed && (dialog || (target !== null && fieldKeeps(target, map, event)))) {
                return;
            }

            const result = step(map, armed, event);

            if (result.consume) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }

            if (result.armed !== armed) {
                arm(result.armed);
            }

            if (result.command !== null && !event.repeat) {
                runCommand(result.command);
            }
        };

        void (async () => {
            let found: Keymap;

            try {
                found = await callAction(keymap, undefined, null);
            } catch {
                found = DEFAULT_KEYMAP;
            }

            if (alive) {
                map = found;
            }
        })();

        window.addEventListener("keydown", onKey, { capture: true });

        return () => {
            alive = false;
            clearTimeout(timer);
            window.removeEventListener("keydown", onKey, { capture: true });
        };
    }, []);

    // A readout, not a control: it takes no tab stop, so the hint shows on hover alone.
    return label === null ? null : (
        <Hint
            label="Prefix key pressed: waiting for the next key"
            keys={
                <KbdGroup>
                    {caps(label).map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                    ))}
                </KbdGroup>
            }
        >
            <span className="text-accent font-mono">{label}</span>
        </Hint>
    );
}

export default {
    status: [{ id: "hotkeys", slot: "end", component: Hotkeys }],
} satisfies WebExtension;
