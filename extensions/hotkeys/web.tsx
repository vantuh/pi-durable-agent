import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import { runCommand } from "@/sdk/commands.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { DEFAULT_KEYMAP, step, type Keymap } from "./lib.ts";
import { keymap } from "./refs.ts";

const ARMED_MS = 1500;

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

            if (map === null || event.isComposing) {
                return;
            }

            // A dialog owns the keyboard; only a prefix already pressed carries on.
            if (!armed && focus?.closest('[role="dialog"]')) {
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

    return label === null ? null : (
        <span
            title="Prefix key pressed: waiting for the next key"
            className="text-accent font-mono"
        >
            {label}
        </span>
    );
}

export default {
    status: [{ id: "hotkeys", slot: "end", component: Hotkeys }],
} satisfies WebExtension;
