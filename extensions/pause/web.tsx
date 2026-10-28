/**
 * The pause control beside Stop, and the same two commands in a session's menu so one conversation
 * can be held while another is open.
 */
import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { ComposerProps, WebExtension } from "@/sdk/types.ts";

import { MARK, pause, resume, state, toggle as toggleAction } from "./refs.ts";

/** The step a hold belongs to: another session or another run starts unpaused. */
type Held = { readonly key: string; readonly paused: boolean };

/** Hidden while the session is idle: a pause holds a step, and an idle session has none to hold. */
function PauseControl({ session }: ComposerProps) {
    const [held, setHeld] = useState<Held>({ key: "", paused: false });
    const id = session?.id ?? null;
    const busy = session?.busy === true;
    const key = `${String(id)}:${String(busy)}`;
    const paused = held.key === key && held.paused;

    useEffect(() => {
        let live = true;

        if (id !== null && busy) {
            void (async () => {
                try {
                    const value = await callAction(state, undefined, id);

                    if (live) {
                        setHeld({ key, paused: value.paused });
                    }
                } catch {
                    // A state nobody can read leaves the button as it is; the hold itself still works.
                }
            })();
        }

        return () => {
            live = false;
        };
    }, [id, busy, key]);

    if (id === null || !busy) {
        return null;
    }

    const next = !paused;
    const toggle = async (): Promise<void> => {
        setHeld({ key, paused: next });
        try {
            const value = await callAction(next ? pause : resume, undefined, id);

            setHeld({ key, paused: value.paused });
        } catch {
            setHeld({ key, paused });
        }
    };

    return (
        <button
            type="button"
            onClick={() => {
                void toggle();
            }}
            title={paused ? "Resume" : "Pause after this step"}
            className={`rounded-control flex size-7 items-center justify-center ${
                paused ? "bg-warn/20 text-warn hover:bg-warn/30" : "text-muted hover:bg-raised"
            }`}
        >
            {paused ? (
                <Play className="size-3 fill-current" />
            ) : (
                <Pause className="size-3 fill-current" />
            )}
        </button>
    );
}

function command(ref: typeof pause): (session: number) => Promise<void> {
    return async (session) => {
        await callAction(ref, undefined, session);
    };
}

const held = (mark: string | undefined): boolean => mark === MARK;

export default {
    composer: [{ id: "pause", component: PauseControl }],
    // One item that says what pressing it does: a held row offers the way out, not a second hold.
    sessionMenu: [
        {
            id: "pause",
            label: (session) => (held(session.mark) ? "Resume" : "Pause after this step"),
            icon: (session) => (held(session.mark) ? <Play /> : <Pause />),
            run: command(toggleAction),
        },
    ],
} satisfies WebExtension;
