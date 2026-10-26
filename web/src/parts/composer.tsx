import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";

type Props = {
    busy: boolean;
    model: string;
    onSend: (text: string) => Promise<void>;
    onStop: () => void;
};

export function Composer({ busy, model, onSend, onStop }: Props) {
    const [text, setText] = useState("");
    const field = useRef<HTMLTextAreaElement>(null);

    const submit = (): void => {
        const body = text.trim();

        if (body === "" || busy) {
            return;
        }

        setText("");
        void onSend(body);
    };

    return (
        <div className="border-edge-soft border-t p-2.5">
            <div className="rounded-card border-edge-soft bg-sunken border p-2.5">
                <textarea
                    ref={field}
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

                <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-meta text-faint truncate font-mono">{model}</span>

                    {busy ? (
                        <button
                            type="button"
                            onClick={onStop}
                            title="Stop"
                            className="rounded-control bg-raised text-ink flex size-7 items-center justify-center"
                        >
                            <Square className="size-3.5" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={submit}
                            title="Send"
                            className="rounded-control bg-accent text-on-accent flex size-7 items-center justify-center disabled:opacity-40"
                            disabled={text.trim() === ""}
                        >
                            <ArrowUp className="size-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
