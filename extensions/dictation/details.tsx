/**
 * What the Extensions dialog shows under Dictation: the language, the model and how long it stays
 * loaded. It lives here rather than in the shell's settings panel so a folder's own settings sit
 * beside its switch.
 */

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { messageOf } from "./record.ts";
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

const LABELS: Record<Language, string> = { auto: "Auto", en: "English", uk: "Ukrainian" };

/** The same box for all three fields: the shell draws them this way everywhere. */
const FIELD =
    "rounded-control border-edge bg-sunken text-ink text-interface focus-visible:ring-accent border px-2 py-1.5 outline-none focus-visible:ring-2";

type Option = { value: string; label: string };

/** One choice out of a few, as a menu: the shell's own dropdown, not the browser's picker. */
function Picker({
    label,
    value,
    options,
    disabled = false,
    onPick,
}: {
    label: string;
    value: string;
    options: Option[];
    disabled?: boolean;
    onPick: (value: string) => void;
}) {
    const chosen = options.find((one) => one.value === value);

    return (
        <div className="flex flex-col gap-1">
            <span className="text-meta text-faint">{label}</span>
            <DropdownMenu>
                <DropdownMenuTrigger
                    disabled={disabled}
                    className={`${FIELD} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
                >
                    <span className="min-w-0 truncate">{chosen?.label ?? "Nothing chosen"}</span>
                    <ChevronDown className="size-3.5 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    {options.map((one) => (
                        <DropdownMenuItem
                            key={one.value}
                            className="justify-between gap-3"
                            onSelect={() => {
                                onPick(one.value);
                            }}
                        >
                            <span className="min-w-0 break-words">{one.label}</span>
                            {one.value === value ? (
                                <Check className="text-accent size-4 shrink-0" />
                            ) : null}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    // Actions come from the server half, which is not there while the folder is off or failed.
    if (!enabled) {
        return <p className="text-meta text-muted">Turn Dictation on to change these settings.</p>;
    }

    if (!installed) {
        return (
            <p className="text-meta text-muted">
                Dictation did not load; the settings are unavailable.
            </p>
        );
    }

    return <Settings />;
}

function Settings() {
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
            <Picker
                label="Language"
                value={current.language}
                options={LANGUAGES.map((one) => ({ value: one, label: LABELS[one] }))}
                onPick={(next) => {
                    if (isLanguage(next)) {
                        change({ language: next });
                    }
                }}
            />
            <p className="text-meta text-muted">
                Auto lets the model detect the language from the recording.
            </p>
            <Picker
                label="Model"
                value={current.model ?? ""}
                options={[
                    { value: "", label: "Auto (first Handy whisper found)" },
                    ...current.models.map((one) => ({
                        value: one.path,
                        label: `${one.name} (${String(one.megabytes)} MB)`,
                    })),
                ]}
                disabled={noModels}
                onPick={(next) => {
                    change({ model: next === "" ? null : next });
                }}
            />
            {noModels ? (
                <p className="text-meta text-muted">
                    No Handy whisper GGUF under ~/.cache/huggingface/hub.
                </p>
            ) : null}
            <label className="flex w-[30%] flex-col gap-1">
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
