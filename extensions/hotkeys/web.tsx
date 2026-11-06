import { useEffect, useState } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import { runCommand, setCommandKeys } from "@/sdk/commands.ts";
import type { WebExtension } from "@/sdk/types.ts";

import {
    caps,
    COMMANDS,
    DEFAULT_KEYMAP,
    fieldKeeps,
    inDialog,
    keymap,
    presses,
    step,
    type Keymap,
} from "./refs.ts";

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
            const target = event.target instanceof HTMLElement ? event.target : null;

            if (map === null || event.isComposing) {
                return;
            }

            // A dialog owns the keyboard; a field keeps what it types but not the prefix, which has to
            // reach `step` so the shell arms from anywhere. Only a prefix already pressed carries on.
            if (
                !armed &&
                (inDialog(focus) || (target !== null && fieldKeeps(target, map, event)))
            ) {
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

                for (const command of COMMANDS) {
                    // A command with several bindings shows the first: one sequence is what a hint holds.
                    const binding = found.keys[command][0];

                    setCommandKeys(command, binding === undefined ? null : presses(found, binding));
                }
            }
        })();

        window.addEventListener("keydown", onKey, { capture: true });

        return () => {
            alive = false;
            clearTimeout(timer);
            window.removeEventListener("keydown", onKey, { capture: true });

            // Off, the folder leaves no label in the core's hints.
            for (const command of COMMANDS) {
                setCommandKeys(command, null);
            }
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
