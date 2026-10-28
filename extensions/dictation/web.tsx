import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/lib/toast.ts";
import type { ComposerProps, WebExtension } from "@/sdk/types.ts";

import { insert } from "./insert.ts";
import {
    messageOf,
    microphone,
    recorderType,
    supportsRecording,
    transcribeRecording,
    warm,
} from "./record.ts";

/** A warm-up that answers sooner than this found the model already loaded: saying so would only flicker. */
const LOADING_SHOWN_AFTER_MS = 300;

type Mode = "idle" | "recording" | "transcribing";

/** Idle is the plain mic; recording says so in red with the ring; transcribing or loading the model waits in yellow. */
function lookOf(mode: Mode, loading: boolean): string {
    if (mode === "recording") {
        return "bg-danger/20 text-danger";
    }

    return mode === "transcribing" || loading
        ? "text-warn"
        : "text-muted hover:text-ink hover:bg-raised";
}

function MicButton({ field, setText }: ComposerProps) {
    const [mode, setMode] = useState<Mode>("idle");
    const [loading, setLoading] = useState(false);
    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const chunks = useRef<Blob[]>([]);
    const starting = useRef(false);
    // The composer hands a new setter as the conversation changes; a recording finishes on the live one.
    const write = useRef(setText);

    useEffect(() => {
        write.current = setText;
    }, [setText]);

    const stopTracks = useCallback((): void => {
        stream.current?.getTracks().forEach((track) => {
            track.stop();
        });
        stream.current = null;
    }, []);

    useEffect(
        () => () => {
            const current = recorder.current;

            recorder.current = null;
            if (current !== null) {
                // Leaving drops the recording: nothing comes back to a button that is gone.
                current.onstop = null;
                current.stop();
            }

            stopTracks();
        },
        [stopTracks],
    );

    const warmUp = useCallback(async (): Promise<void> => {
        const showing = setTimeout(() => {
            setLoading(true);
        }, LOADING_SHOWN_AFTER_MS);

        try {
            await warm();
        } catch (failure) {
            toast.error(messageOf(failure));
        } finally {
            clearTimeout(showing);
            setLoading(false);
        }
    }, []);

    const finish = useCallback(async (): Promise<void> => {
        const recorded = chunks.current;

        chunks.current = [];
        setMode("transcribing");

        try {
            const text = await transcribeRecording(recorded);

            if (text === "") {
                throw new Error("Nothing was recognised.");
            }

            const element = field.current;
            const at = element?.selectionStart ?? 0;
            const words = insert(
                {
                    value: element?.value ?? "",
                    selectionStart: at,
                    selectionEnd: element?.selectionEnd ?? at,
                },
                text,
            );

            write.current(words.value);
            // The box is drawn from its value again, which puts the caret at the end: put it back after the words.
            requestAnimationFrame(() => {
                field.current?.setSelectionRange(words.at, words.at);
            });
        } catch (failure) {
            toast.error(messageOf(failure));
        } finally {
            setMode("idle");
        }
    }, [field]);

    const start = useCallback(async (): Promise<void> => {
        if (starting.current || recorder.current !== null) {
            return;
        }

        if (!supportsRecording()) {
            toast.error("This browser cannot record audio.");

            return;
        }

        starting.current = true;

        try {
            const media = await microphone();

            stream.current = media;
            chunks.current = [];

            const type = recorderType();
            const made = new MediaRecorder(media, type === undefined ? {} : { mimeType: type });

            made.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.current.push(event.data);
                }
            };
            made.onstop = () => {
                void finish();
            };
            recorder.current = made;
            made.start();
            setMode("recording");
            void warmUp();
        } catch (failure) {
            stopTracks();
            toast.error(messageOf(failure));
        } finally {
            starting.current = false;
        }
    }, [finish, stopTracks, warmUp]);

    const stop = useCallback((): void => {
        const current = recorder.current;

        if (current === null) {
            return;
        }

        recorder.current = null;
        stopTracks();
        current.stop();
    }, [stopTracks]);

    const toggle = (): void => {
        if (mode === "transcribing") {
            return;
        }

        if (recorder.current === null) {
            void start();
        } else {
            stop();
        }
    };

    const said =
        mode === "recording"
            ? "Stop dictating"
            : mode === "transcribing"
              ? "Transcribing…"
              : "Dictate on this machine";

    return (
        <button
            type="button"
            aria-label="Dictate"
            aria-pressed={mode === "recording"}
            title={loading ? `${said} (loading the model)` : said}
            // Keep focus in the textarea so words go in at the caret and the phone keyboard stays put.
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            onClick={toggle}
            className={`rounded-control relative mr-1 flex size-7 items-center justify-center ${lookOf(mode, loading)}`}
        >
            <Mic className="size-4" />
            {mode === "recording" ? (
                <span className="rounded-control border-danger pointer-events-none absolute inset-0 animate-ping border motion-reduce:hidden" />
            ) : null}
        </button>
    );
}

export default {
    composer: [{ id: "mic", component: MicButton }],
} satisfies WebExtension;
