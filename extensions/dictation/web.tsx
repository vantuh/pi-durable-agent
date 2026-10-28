import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner.tsx";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import type { ComposerProps, SettingsProps, WebExtension } from "@/sdk/types.ts";

import { insert } from "./insert.ts";
import {
    messageOf,
    microphone,
    recorderType,
    supportsRecording,
    transcribeRecording,
    warm,
} from "./record.ts";
import {
    isLanguage,
    LANGUAGES,
    MAX_IDLE_MINUTES,
    MIN_IDLE_MINUTES,
    saveSettings,
    settings,
    type Language,
    type Settings,
    type SettingsFields,
} from "./refs.ts";

/** A warm-up that answers sooner than this found the model already loaded: saying so would only flicker. */
const LOADING_SHOWN_AFTER_MS = 300;

const LABELS: Record<Language, string> = { auto: "Auto", en: "English", uk: "Ukrainian" };

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

/** The same box for all three fields: the shell draws them this way everywhere. */
const FIELD =
    "rounded-control border-edge bg-sunken text-ink text-interface focus-visible:ring-accent border px-2 py-1.5 outline-none focus-visible:ring-2";

function DictationSettings(_props: SettingsProps) {
    const [current, setCurrent] = useState<Settings | undefined>();
    const [idle, setIdle] = useState("");
    // Saves go out in order but their answers need not arrive in order: only the last may draw.
    const turn = useRef(0);

    useEffect(() => {
        let live = true;

        const read = async (): Promise<void> => {
            try {
                const found = await callAction(settings, undefined, null);

                if (live) {
                    setCurrent(found);
                    setIdle(String(found.idleMinutes));
                }
            } catch (failure) {
                if (live) {
                    toast.error(messageOf(failure));
                }
            }
        };

        void read();

        return () => {
            live = false;
        };
    }, []);

    /** One `saveSettings` for all three fields; a refusal puts the boxes back to what the server holds. */
    const save = async (wanted: SettingsFields, before: Settings, mine: number): Promise<void> => {
        try {
            const answer = await callAction(saveSettings, wanted, null);

            if (mine === turn.current) {
                setCurrent(answer);
                setIdle(String(answer.idleMinutes));
            }
        } catch (failure) {
            if (mine === turn.current) {
                setCurrent(before);
                setIdle(String(before.idleMinutes));
            }

            toast.error(messageOf(failure));
        }
    };

    const change = (next: Partial<SettingsFields>): void => {
        if (current === undefined) {
            return;
        }

        const before = current;
        const typed = Number(idle.trim());
        const wanted: SettingsFields = {
            language: next.language ?? before.language,
            model: next.model === undefined ? before.model : next.model,
            // Whatever the box holds is what is saved, so changing the language keeps a typed idle time.
            idleMinutes:
                next.idleMinutes ??
                (idle.trim() !== "" && Number.isFinite(typed) ? typed : before.idleMinutes),
        };
        const mine = ++turn.current;

        setCurrent({ ...before, language: wanted.language, model: wanted.model });
        void save(wanted, before, mine);
    };

    // A number is saved when it is done, never per keystroke: on Enter, and on leaving the box.
    const commitIdle = (): void => {
        if (current === undefined) {
            return;
        }

        const text = idle.trim();

        if (text === "" || Number(text) === current.idleMinutes) {
            setIdle(String(current.idleMinutes));

            return;
        }

        change({ idleMinutes: Number(text) });
    };

    if (current === undefined) {
        return <Spinner className="text-faint" />;
    }

    const noModels = current.models.length === 0;

    return (
        <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
                <span className="text-meta text-faint">Language</span>
                <select
                    value={current.language}
                    onChange={(event) => {
                        const next: string = event.target.value;

                        if (isLanguage(next)) {
                            change({ language: next });
                        }
                    }}
                    className={FIELD}
                >
                    {LANGUAGES.map((one) => (
                        <option key={one} value={one}>
                            {LABELS[one]}
                        </option>
                    ))}
                </select>
            </label>
            <p className="text-meta text-muted">
                Auto lets the model detect the language from the recording.
            </p>
            <label className="flex flex-col gap-1">
                <span className="text-meta text-faint">Model</span>
                <select
                    value={current.model ?? ""}
                    disabled={noModels}
                    onChange={(event) => {
                        const chosen = event.target.value;

                        change({ model: chosen === "" ? null : chosen });
                    }}
                    className={FIELD}
                >
                    <option value="">Auto (first Handy whisper found)</option>
                    {current.models.map((one) => (
                        <option key={one.path} value={one.path}>
                            {`${one.name} (${String(one.megabytes)} MB)`}
                        </option>
                    ))}
                </select>
            </label>
            {noModels ? (
                <p className="text-meta text-muted">
                    No Handy whisper GGUF under ~/.cache/huggingface/hub.
                </p>
            ) : null}
            <label className="flex flex-col gap-1">
                <span className="text-meta text-faint">Idle time (minutes)</span>
                <input
                    type="number"
                    min={MIN_IDLE_MINUTES}
                    max={MAX_IDLE_MINUTES}
                    value={idle}
                    onChange={(event) => {
                        setIdle(event.target.value);
                    }}
                    onBlur={commitIdle}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commitIdle();
                        }
                    }}
                    className={FIELD}
                />
            </label>
            <p className="text-meta text-muted">0 lets the model go right after each dictation.</p>
        </div>
    );
}

export default {
    composer: [{ id: "mic", component: MicButton }],
    settings: [{ id: "language", title: "Dictation", component: DictationSettings }],
} satisfies WebExtension;
