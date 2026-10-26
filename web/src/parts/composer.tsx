import { ArrowUp, Check, ChevronDown, Paperclip, Sparkles, Square } from "lucide-react";
import { useRef, useState } from "react";

import type { ClientQueued, SendMode } from "../../../shared/protocol.ts";
import { uploadFile } from "../lib/api.ts";
import { Attachments, type Pending } from "./attachments.tsx";

const MODES: { mode: SendMode; label: string; hint: string }[] = [
    { mode: "steer", label: "Steer", hint: "read after the current step" },
    { mode: "followUp", label: "Queue", hint: "read when this run ends" },
    { mode: "interrupt", label: "Interrupt", hint: "stop the run now, then send" },
];

type Props = {
    busy: boolean;
    queued: ClientQueued[];
    model: string;
    level: string | null;
    menuOpen: boolean;
    onToggleMenu: () => void;
    onSend: (text: string, files: string[], mode?: SendMode) => Promise<void>;
    onStop: () => void;
};

export function Composer({
    busy,
    queued,
    model,
    level,
    menuOpen,
    onToggleMenu,
    onSend,
    onStop,
}: Props) {
    const [text, setText] = useState("");
    const [files, setFiles] = useState<Pending[]>([]);
    const [mode, setMode] = useState<SendMode>("steer");
    const [modesOpen, setModesOpen] = useState(false);
    const picker = useRef<HTMLInputElement>(null);

    // An Interrupt is for the run it was chosen in; the next run starts on Steer again.
    if (!busy && mode === "interrupt") {
        setMode("steer");
    }

    if (!busy && modesOpen) {
        setModesOpen(false);
    }

    const how = MODES.find((option) => option.mode === mode);
    const uploading = files.some((file) => file.state === "uploading");
    const empty = text.trim() === "" && files.length === 0;

    const forget = (gone: Pending[]): void => {
        for (const file of gone) {
            if (file.preview !== undefined) {
                URL.revokeObjectURL(file.preview);
            }
        }
    };

    // Each file shows at once as uploading and settles on its own: done with a path, or failed.
    const addFiles = (chosen: File[]): void => {
        const fresh = chosen.map((file): [File, Pending] => {
            const image = /^image\/(png|jpe?g|gif|webp)$/.test(file.type);

            return [
                file,
                {
                    key: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    image,
                    state: "uploading",
                    ...(image ? { preview: URL.createObjectURL(file) } : {}),
                },
            ];
        });

        setFiles((current) => [...current, ...fresh.map(([, pending]) => pending)]);

        for (const [file, pending] of fresh) {
            void (async () => {
                const saved = await uploadFile(file);

                setFiles((current) =>
                    current.map((each) =>
                        each.key === pending.key
                            ? saved === undefined
                                ? { ...each, state: "error" }
                                : { ...each, state: "done", path: saved.path, size: saved.size }
                            : each,
                    ),
                );
            })();
        }
    };

    const submit = (): void => {
        const body = text.trim();

        if (empty || uploading) {
            return;
        }

        const paths = files.flatMap((file) =>
            file.state === "done" && file.path !== undefined ? [file.path] : [],
        );

        if (body === "" && paths.length === 0) {
            return;
        }

        setText("");
        forget(files);
        setFiles([]);
        setMode((current) => (current === "interrupt" ? "steer" : current));
        void onSend(body, paths, busy ? mode : undefined);
    };

    return (
        <div>
            {queued.length === 0 ? null : (
                <ul className="mb-2 flex flex-col gap-1">
                    {queued.map((item) => (
                        <li
                            key={item.id}
                            className="text-meta text-faint flex min-w-0 items-baseline gap-2 px-1"
                        >
                            <span className="text-muted shrink-0">
                                {item.mode === "steer" ? "Steer" : "Queued"}
                            </span>
                            <span className="min-w-0 truncate">{item.text}</span>
                        </li>
                    ))}
                </ul>
            )}

            <div
                className="rounded-card border-edge bg-sunken focus-within:border-accent relative border p-2"
                onDragOver={(event) => {
                    event.preventDefault();
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    addFiles([...event.dataTransfer.files]);
                }}
                onPaste={(event) => {
                    const pasted = [...event.clipboardData.files];

                    if (pasted.length > 0) {
                        event.preventDefault();
                        addFiles(pasted);
                    }
                }}
            >
                <Attachments
                    files={files}
                    onRemove={(key) => {
                        forget(files.filter((file) => file.key === key));
                        setFiles((current) => current.filter((file) => file.key !== key));
                    }}
                />

                <textarea
                    rows={2}
                    value={text}
                    placeholder={
                        busy && how !== undefined
                            ? `${how.label}: ${how.hint}…`
                            : "Ask the agent to change something…"
                    }
                    className="text-prose text-ink placeholder:text-faint block [field-sizing:content] max-h-[10lh] min-h-[2lh] w-full resize-none overflow-y-auto bg-transparent outline-none"
                    onChange={(event) => {
                        setText(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />

                <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                        type="button"
                        title="Attach a file"
                        onClick={() => {
                            picker.current?.click();
                        }}
                        className="text-muted hover:text-ink rounded-control hover:bg-raised flex size-7 items-center justify-center"
                    >
                        <Paperclip className="size-4" />
                    </button>

                    <input
                        ref={picker}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                            const chosen = [...(event.target.files ?? [])];

                            event.target.value = "";

                            if (chosen.length === 0) {
                                return;
                            }

                            addFiles(chosen);
                        }}
                    />

                    <button
                        type="button"
                        onClick={onToggleMenu}
                        className={`text-interface flex items-center gap-1.5 rounded-full px-2 py-1 ${
                            menuOpen ? "bg-raised text-ink" : "text-muted hover:bg-raised"
                        }`}
                    >
                        <Sparkles className="text-accent size-3.5" />
                        <span className="max-w-[12rem] truncate font-mono">{model}</span>
                        {level === null ? null : <span className="text-faint">{level}</span>}
                        <ChevronDown className="size-3.5" />
                    </button>

                    <div className="ml-auto flex items-center gap-1.5">
                        {busy ? (
                            <button
                                type="button"
                                onClick={onStop}
                                title="Stop"
                                className="rounded-control bg-danger/20 text-danger hover:bg-danger/30 flex size-7 items-center justify-center"
                            >
                                <Square className="size-3 fill-current" />
                            </button>
                        ) : null}
                        <div
                            className="relative flex items-center"
                            onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget)) {
                                    setModesOpen(false);
                                }
                            }}
                        >
                            {modesOpen ? (
                                <ul className="rounded-control border-edge bg-panel absolute right-0 bottom-full mb-1.5 flex w-64 flex-col border p-1 shadow-lg">
                                    {MODES.map((option) => (
                                        <li key={option.mode}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setMode(option.mode);
                                                    setModesOpen(false);
                                                }}
                                                className="rounded-control hover:bg-raised flex w-full items-start gap-2 px-2 py-1.5 text-left"
                                            >
                                                <Check
                                                    className={`text-accent mt-0.5 size-3.5 shrink-0 ${
                                                        option.mode === mode ? "" : "invisible"
                                                    }`}
                                                />
                                                <span className="flex flex-col">
                                                    <span className="text-interface text-ink">
                                                        {option.label}
                                                    </span>
                                                    <span className="text-meta text-faint">
                                                        {option.hint}
                                                    </span>
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <button
                                type="button"
                                onClick={submit}
                                title={busy ? (how?.label ?? "Send") : "Send"}
                                className={`bg-accent text-on-accent flex h-7 items-center justify-center gap-1 disabled:opacity-40 ${
                                    busy
                                        ? "rounded-l-control text-interface pr-1.5 pl-2"
                                        : "rounded-control w-7"
                                }`}
                                disabled={empty || uploading}
                            >
                                <ArrowUp className="size-4" />
                                {busy ? <span>{how?.label}</span> : null}
                            </button>
                            {busy ? (
                                <button
                                    type="button"
                                    title="How to send"
                                    aria-haspopup="menu"
                                    aria-expanded={modesOpen}
                                    onClick={() => {
                                        setModesOpen((open) => !open);
                                    }}
                                    className="rounded-r-control bg-accent text-on-accent border-on-accent/30 flex h-7 w-6 items-center justify-center border-l"
                                >
                                    <ChevronDown className="size-3.5" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
