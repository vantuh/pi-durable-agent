import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { toast } from "@/lib/toast.ts";
import type { ComposerProps, WebExtension } from "@/sdk/types.ts";

import { createDictation, dictationAvailable, type Dictation } from "./dictate.ts";

function MicButton({ field, setText, onSent }: ComposerProps) {
    const [listening, setListening] = useState(false);
    const write = useRef(setText);
    const dictation = useRef<Dictation | null>(null);

    useEffect(() => {
        write.current = setText;
    }, [setText]);

    // Leaving, sending and the tab going out of sight end dictation; Alt+V starts and stops it.
    useEffect(() => {
        const current = createDictation({
            field: () => field.current,
            focused: () => document.activeElement === field.current,
            onText: (value) => {
                write.current(value);
            },
            onListening: setListening,
            onNotice: (level, text) => {
                toast[level](text);
            },
        });
        const hidden = (): void => {
            if (document.hidden) {
                current.stop();
            }
        };
        const shortcut = (event: KeyboardEvent): void => {
            if (event.altKey && event.code === "KeyV") {
                event.preventDefault();
                current.toggle();
            }
        };
        const unsubscribe = onSent(() => {
            current.stop(true);
        });

        dictation.current = current;
        document.addEventListener("visibilitychange", hidden);
        window.addEventListener("keydown", shortcut);

        return () => {
            dictation.current = null;
            unsubscribe();
            document.removeEventListener("visibilitychange", hidden);
            window.removeEventListener("keydown", shortcut);
            current.stop(true);
        };
    }, [field, onSent]);

    if (!dictationAvailable()) {
        return null;
    }

    return (
        <button
            type="button"
            aria-label="Dictate"
            aria-pressed={listening}
            title={listening ? "Listening: tap to stop (Alt+V)" : "Dictate (Alt+V)"}
            // Keep focus in the textarea so words go in at the caret and the phone keyboard stays put.
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            onClick={() => {
                dictation.current?.toggle();
            }}
            className={`rounded-control relative flex size-7 items-center justify-center ${
                listening ? "bg-accent/20 text-accent" : "text-muted hover:text-ink hover:bg-raised"
            }`}
        >
            <Mic className="size-4" />
            {listening ? (
                <span className="rounded-control border-accent pointer-events-none absolute inset-0 animate-ping border motion-reduce:hidden" />
            ) : null}
        </button>
    );
}

export default { composer: [{ id: "mic", component: MicButton }] } satisfies WebExtension;
