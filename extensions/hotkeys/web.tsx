import { useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import { runCommand } from "@/sdk/commands.ts";
import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";

import { DEFAULT_KEYMAP, step, type Command, type Keymap } from "./lib.ts";
import { neighbour } from "./neighbour.ts";
import { keymap } from "./refs.ts";

const ARMED_MS = 1500;

/** Shift and the arrows are text editing too, so they act only where there is no text to edit. */
function holdsText(element: Element | null): boolean {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value !== "";
    }

    return (
        element instanceof HTMLElement && element.isContentEditable && element.textContent !== ""
    );
}

function Hotkeys(props: StatusItemProps) {
    const [label, setLabel] = useState<string | null>(null);
    const latest = useRef(props);

    useEffect(() => {
        latest.current = props;
    });

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

        const run = (command: Command): void => {
            const { session, sessions, openSession } = latest.current;

            if (command === "session.prev" || command === "session.next") {
                const target = neighbour(
                    sessions,
                    session?.id ?? null,
                    command === "session.next" ? 1 : -1,
                );

                if (target !== null) {
                    openSession(target);
                }
            } else {
                runCommand(command);
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

            if (!armed && result.command !== null && holdsText(focus)) {
                return;
            }

            if (result.consume) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }

            if (result.armed !== armed) {
                arm(result.armed);
            }

            if (result.command !== null && !event.repeat) {
                run(result.command);
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
