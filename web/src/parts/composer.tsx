import { ArrowUp, ChevronDown, Paperclip, Sparkles, Square } from "lucide-react";
import { useRef, useState } from "react";

import type { UploadedFile } from "../lib/api.ts";
import { uploadFile } from "../lib/api.ts";
import { Attachments } from "./attachments.tsx";

type Props = {
    busy: boolean;
    model: string;
    level: string | null;
    menuOpen: boolean;
    onToggleMenu: () => void;
    onSend: (text: string, files: string[]) => Promise<void>;
    onStop: () => void;
};

export function Composer({ busy, model, level, menuOpen, onToggleMenu, onSend, onStop }: Props) {
    const [text, setText] = useState("");
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [busyUpload, setBusyUpload] = useState(false);
    const picker = useRef<HTMLInputElement>(null);

    const submit = (): void => {
        const body = text.trim();

        if ((body === "" && files.length === 0) || busy) {
            return;
        }

        const paths = files.map((file) => file.path);

        setText("");
        setFiles([]);
        void onSend(body, paths);
    };

    return (
        <div className="border-edge-soft border-t p-2.5">
            <div className="rounded-card border-edge bg-sunken focus-within:border-accent relative border p-2.5">
                <Attachments
                    files={files}
                    onRemove={(path) => {
                        setFiles((current) => current.filter((file) => file.path !== path));
                    }}
                />

                <textarea
                    rows={2}
                    value={text}
                    placeholder="Ask the agent to change something…"
                    className="text-prose text-ink placeholder:text-faint block w-full resize-none bg-transparent outline-none"
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

                            setBusyUpload(true);
                            void (async () => {
                                const uploaded = await Promise.all(
                                    chosen.map((file) => uploadFile(file)),
                                );

                                setBusyUpload(false);
                                setFiles((current) => [
                                    ...current,
                                    ...uploaded.filter(
                                        (file): file is UploadedFile => file !== undefined,
                                    ),
                                ]);
                            })();
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

                    {busyUpload ? <span className="text-faint text-meta">uploading…</span> : null}

                    <div className="ml-auto flex items-center gap-1.5">
                        {busy ? (
                            <button
                                type="button"
                                onClick={onStop}
                                title="Stop"
                                className="rounded-control bg-raised text-danger flex size-7 items-center justify-center"
                            >
                                <Square className="size-3.5" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={submit}
                                title="Send"
                                className="rounded-control bg-accent text-on-accent flex size-7 items-center justify-center disabled:opacity-40"
                                disabled={text.trim() === "" && files.length === 0}
                            >
                                <ArrowUp className="size-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
