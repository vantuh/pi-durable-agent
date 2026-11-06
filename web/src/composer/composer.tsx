import { Square } from "lucide-react";
import {
    memo,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";
import { runCommand } from "@/lib/api.ts";
import { withQuotes } from "@/lib/quote.ts";
import { toast } from "@/lib/toast.ts";
import {
    clearComposerQuotes,
    composerDraft,
    composerQuotes,
    removeComposerQuote,
    setComposerDraft,
    subscribeComposerDraft,
    subscribeComposerFocus,
    subscribeComposerQuotes,
} from "@/sdk/composer.ts";
import type { StatusProps } from "@/sdk/types.ts";
import { Attachments } from "@/ui/attachments.tsx";
import { QuoteCard } from "@/ui/quote.tsx";

import type { ClientQueued, SendMode } from "../../../shared/protocol.ts";
import { AttachButton } from "./attachments/attach-button.tsx";
import { DropOverlay } from "./attachments/drop-overlay.tsx";
import { forget } from "./attachments/pending.ts";
import { useAttachments } from "./attachments/use-attachments.ts";
import { CompletionList } from "./completion/completion-list.tsx";
import { useCompletion } from "./completion/use-completion.ts";
import { remember } from "./history/history-store.ts";
import { useHistory } from "./history/use-history.ts";
import { ComposerItems } from "./items.tsx";
import { editQueued, takeQueued } from "./queued-actions.ts";
import { Queued } from "./queued.tsx";
import { ModelChip } from "./toolbar/model-chip.tsx";
import { SendButton } from "./toolbar/send-button.tsx";
import { MODES } from "./toolbar/send-modes.ts";

type Props = {
    sessionId: string;
    session: StatusProps["session"];
    busy: boolean;
    queued: ClientQueued[];
    /** Drawn between the queued messages and the box, so the queue stays next to the transcript. */
    above?: ReactNode;
    model: string;
    level: string | null;
    menuOpen: boolean;
    onToggleMenu: () => void;
    onSend: (text: string, files: string[], mode?: SendMode) => Promise<boolean>;
    onStop: () => void;
    /** Opens a new session in the folder this one works in. */
    onNewSession: () => void;
};

export const Composer = memo(function Composer({
    sessionId,
    session,
    busy,
    queued,
    above,
    model,
    level,
    menuOpen,
    onToggleMenu,
    onSend,
    onStop,
    onNewSession,
}: Props) {
    const text = useSyncExternalStore(subscribeComposerDraft, () => composerDraft(sessionId));
    const quotes = useSyncExternalStore(subscribeComposerQuotes, () => composerQuotes(sessionId));
    const { files, setFiles, addFiles, uploading, batch, dragging } = useAttachments(sessionId);
    const history = useHistory(sessionId);
    const [mode, setMode] = useState<SendMode>("steer");
    const field = useRef<HTMLTextAreaElement>(null);
    // App keys the composer by session, so this runs on every session switch.
    useEffect(() => {
        field.current?.focus({ preventScroll: true });
    }, []);
    useEffect(
        () =>
            subscribeComposerFocus(() => {
                field.current?.focus({ preventScroll: true });

                return field.current !== null && document.activeElement === field.current;
            }),
        [],
    );
    const sentListeners = useRef(new Set<() => void>());
    const onSent = useCallback((listener: () => void) => {
        sentListeners.current.add(listener);

        return () => {
            sentListeners.current.delete(listener);
        };
    }, []);
    const { matches, marked, setMarked, setCaret, pick, handleKey } = useCompletion({
        sessionId,
        text,
        field,
        instantOk: files.length === 0 && quotes.length === 0,
        onNewSession,
        onToggleMenu,
    });

    // An Interrupt is for the run it was chosen in; the next run starts on Steer again.
    if (!busy && mode === "interrupt") {
        setMode("steer");
    }

    const how = MODES.find((option) => option.mode === mode);
    const empty = text.trim() === "" && files.length === 0 && quotes.length === 0;

    const submit = (): void => {
        const written = text.trim();

        if (empty || uploading) {
            return;
        }

        const paths = files.flatMap((file) =>
            file.state === "done" && file.path !== undefined ? [file.path] : [],
        );

        if (written === "" && paths.length === 0 && quotes.length === 0) {
            return;
        }

        for (const listener of sentListeners.current) {
            listener();
        }

        // A command is not a message: it never enters the transcript, and its arguments are not files.
        const command = quotes.length === 0 ? /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(written) : null;
        const name = command?.[1];
        const args = command?.[2]?.trim() ?? "";

        if (name === "new" && args === "" && paths.length === 0) {
            setComposerDraft(sessionId, "");
            clearComposerQuotes(sessionId);
            history.reset();
            onNewSession();

            return;
        }

        if (name === "model" && args === "" && paths.length === 0) {
            setComposerDraft(sessionId, "");
            clearComposerQuotes(sessionId);
            history.reset();
            onToggleMenu();

            return;
        }

        if (name === "compact" && paths.length === 0) {
            setComposerDraft(sessionId, "");
            clearComposerQuotes(sessionId);
            history.reset();
            void (async () => {
                try {
                    const result = await runCommand(Number(sessionId), "compact", args);

                    if (result === "empty") {
                        toast.warning("Nothing to compact: the conversation is too short");
                    }
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not compact");
                }
            })();

            return;
        }

        const body = withQuotes(quotes, written);
        const sending = files;

        remember(sessionId, body);
        setComposerDraft(sessionId, "");
        clearComposerQuotes(sessionId);
        history.reset();
        setFiles(() => []);
        setMode((current) => (current === "interrupt" ? "steer" : current));

        void (async () => {
            if (await onSend(body, paths, busy ? mode : undefined)) {
                forget(sending);

                return;
            }

            // The words come back from ↑; the uploaded files cannot, so they return themselves, with the
            // previews a send that never went did not revoke.
            setFiles((current) => [...sending, ...current]);
        })();
    };

    return (
        // The transcript's column: its width setting plus the px-4 its scroll area pads with, so the edges line up.
        <div className="mx-auto w-full max-w-[calc(var(--chat-width)+2rem)] px-4 pt-2">
            <DropOverlay dragging={dragging} batch={batch} />

            <Queued
                items={queued}
                onWithdraw={(item) => {
                    void takeQueued(sessionId, item);
                }}
                onEdit={(item) => {
                    void editQueued(sessionId, item, {
                        setMode,
                        setFiles,
                        focus: () => {
                            field.current?.focus();
                        },
                    });
                }}
            />

            <div className="mb-2 empty:hidden">{above}</div>

            <div
                className="border-edge bg-sunken focus-within:border-accent relative border p-2"
                onPaste={(event) => {
                    const pasted = [...event.clipboardData.files];

                    if (pasted.length > 0) {
                        event.preventDefault();
                        addFiles(pasted);
                    }
                }}
            >
                {matches.length === 0 ? null : (
                    <CompletionList matches={matches} marked={marked} onPick={pick} />
                )}

                <Attachments
                    files={files}
                    onRemove={(key) => {
                        forget(files.filter((file) => file.key === key));
                        setFiles((current) => current.filter((file) => file.key !== key));
                    }}
                />

                {quotes.length === 0 ? null : (
                    <div className="mb-1.5 flex flex-col gap-1.5">
                        {quotes.map((quote, index) => (
                            <QuoteCard
                                key={quote}
                                text={quote}
                                onRemove={() => {
                                    removeComposerQuote(sessionId, index);
                                }}
                            />
                        ))}
                    </div>
                )}

                <ScrollArea viewportProps={{ className: "text-interface max-h-[10lh]" }}>
                    <textarea
                        rows={2}
                        ref={field}
                        data-slot="composer-field"
                        aria-label="Message"
                        // Opted in: the shell's keys, the session arrows among them, work while typing here.
                        data-shell-keys
                        value={text}
                        placeholder={
                            busy && how !== undefined
                                ? `${how.label}: ${how.hint}…`
                                : "Ask the agent to change something…"
                        }
                        className="text-interface text-ink placeholder:text-faint block [field-sizing:content] min-h-[2lh] w-full resize-none bg-transparent outline-none"
                        onChange={(event) => {
                            const value = event.target.value;

                            setMarked(0);
                            setCaret(event.target.selectionStart);

                            history.reset();
                            setComposerDraft(sessionId, value);
                        }}
                        onSelect={(event) => {
                            setCaret(event.currentTarget.selectionStart);
                        }}
                        onKeyDown={(event) => {
                            if (handleKey(event)) {
                                return;
                            }

                            history.handleKey(event);

                            if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !window.matchMedia("(pointer: coarse)").matches
                            ) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                    />
                </ScrollArea>

                <div className="mt-1.5 flex items-center gap-1.5">
                    <AttachButton onFiles={addFiles} />

                    <ModelChip
                        model={model}
                        level={level}
                        menuOpen={menuOpen}
                        onToggleMenu={onToggleMenu}
                    />

                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <ComposerItems
                            session={session}
                            field={field}
                            setText={(value) => {
                                history.reset();
                                setComposerDraft(sessionId, value);
                            }}
                            onSent={onSent}
                        />
                        {busy ? (
                            <Hint label="Stop">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Stop"
                                    onClick={onStop}
                                    className="bg-danger/20 text-danger hover:bg-danger/30 hover:text-danger"
                                >
                                    <Square className="size-3 fill-current" />
                                </Button>
                            </Hint>
                        ) : null}
                        <SendButton
                            busy={busy}
                            how={how}
                            mode={mode}
                            disabled={empty || uploading}
                            field={field}
                            onModeChange={setMode}
                            onSend={submit}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});
