import { ArrowUp, Check, ChevronDown, Paperclip, Sparkles, Square } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { ClientAttachment, ClientQueued, SendMode } from "../../../shared/protocol.ts";
import { listSkills, runCommand, type SkillInfo, uploadFile, withdrawQueued } from "../lib/api.ts";
import { thinkingText } from "../lib/thinking.ts";
import { toast } from "../lib/toast.ts";
import { composerDraft, setComposerDraft, subscribeComposerDraft } from "../sdk/composer.ts";
import type { StatusProps } from "../sdk/types.ts";
import { Attachments, type Pending } from "../ui/attachments.tsx";
import { composerFiles, setComposerFiles } from "./files.ts";
import { ComposerItems } from "./items.tsx";
import { Queued } from "./queued.tsx";

const MODES: { mode: SendMode; label: string; hint: string }[] = [
    { mode: "steer", label: "Steer", hint: "read after the current step" },
    { mode: "followUp", label: "Queue", hint: "read when this run ends" },
    { mode: "interrupt", label: "Interrupt", hint: "stop the run now, then send" },
];

const HISTORY_KEY = "composer-history";
const HISTORY_MAX = 100;

/** What the composer runs itself instead of saying something; the same names `submit` matches on. */
const COMMANDS: { name: string; description: string; takesArgs: boolean }[] = [
    { name: "new", description: "Open a new session in this folder", takesArgs: false },
    { name: "compact", description: "Summarize the earlier messages", takesArgs: true },
];

type Candidate = { label: string; description: string; insert: string };

// Sent messages are remembered per session, so an empty chat never recalls another chat's text.
function loadHistory(sessionId: string): string[] {
    try {
        const parsed: unknown = JSON.parse(
            localStorage.getItem(`${HISTORY_KEY}:${sessionId}`) ?? "[]",
        );

        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [];
    } catch {
        return [];
    }
}

function remember(sessionId: string, text: string): void {
    const past = loadHistory(sessionId);

    if (past.at(-1) === text) {
        return;
    }

    try {
        localStorage.setItem(
            `${HISTORY_KEY}:${sessionId}`,
            JSON.stringify([...past, text].slice(-HISTORY_MAX)),
        );
    } catch {
        // History is a convenience; storage may be full or blocked.
    }
}

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
    onSend: (text: string, files: string[], mode?: SendMode) => Promise<void>;
    onStop: () => void;
    /** Opens a new session in the folder this one works in. */
    onNewSession: () => void;
};

function forget(gone: Pending[]): void {
    for (const file of gone) {
        if (file.preview !== undefined) {
            URL.revokeObjectURL(file.preview);
        }
    }
}

/** A file that waits in the queue, back as a composer attachment: the bytes are still under its path. */
function pendingOf(file: ClientAttachment): Pending {
    return {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        image: file.image,
        state: "done",
        path: file.path,
        ...(file.image ? { preview: `/api/uploads?path=${encodeURIComponent(file.path)}` } : {}),
    };
}

export function Composer({
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
    const [text, setText] = useState(() => composerDraft(sessionId));
    useEffect(
        () =>
            subscribeComposerDraft(() => {
                setText(composerDraft(sessionId));
            }),
        [sessionId],
    );
    const [files, setLocalFiles] = useState<Pending[]>(() => composerFiles(sessionId));
    // Written through the store too, so an upload that ends after the session was left still lands.
    const setFiles = (update: (current: Pending[]) => Pending[]): void => {
        const next = update(composerFiles(sessionId));
        setComposerFiles(sessionId, next);
        setLocalFiles(next);
    };
    // Position in history while browsing with the arrows (null: not browsing) and the draft to come back to.
    const browse = useRef<{ at: number; draft: string } | null>(null);
    const [mode, setMode] = useState<SendMode>("steer");
    const [modesOpen, setModesOpen] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    const sentListeners = useRef(new Set<() => void>());
    const onSent = useCallback((listener: () => void) => {
        sentListeners.current.add(listener);

        return () => {
            sentListeners.current.delete(listener);
        };
    }, []);
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [marked, setMarked] = useState(0);
    // The list closes on Escape and opens again when the text changes.
    const [dismissed, setDismissed] = useState<string | null>(null);

    useEffect(() => {
        void listSkills(Number(sessionId)).then(setSkills);
    }, [sessionId]);

    // "/" or "/ne" (no space yet) asks for a command or a skill; names that start with the typed letters come
    // first. A picked command is inserted without a trailing space, so the pick closes the list itself.
    const typed = /^\/(?:skill:)?([\w-]*)$/.exec(text)?.[1]?.toLowerCase();
    const skillsByName =
        typed === undefined
            ? []
            : [
                  ...skills.filter((skill) => skill.name.toLowerCase().startsWith(typed)),
                  ...(typed.length < 2
                      ? []
                      : skills.filter(
                            (skill) =>
                                !skill.name.toLowerCase().startsWith(typed) &&
                                skill.name.toLowerCase().includes(typed),
                        )),
              ];
    const matches: Candidate[] =
        typed === undefined || dismissed === text
            ? []
            : [
                  ...COMMANDS.filter((command) => command.name.startsWith(typed)).map(
                      (command): Candidate => ({
                          label: `/${command.name}`,
                          description: command.description,
                          insert: `/${command.name}${command.takesArgs ? " " : ""}`,
                      }),
                  ),
                  ...skillsByName.map((skill): Candidate => ({
                      label: `/skill:${skill.name}`,
                      description: skill.description,
                      insert: `/skill:${skill.name} `,
                  })),
              ];
    const pick = (candidate: Candidate): void => {
        setComposerDraft(sessionId, candidate.insert);
        setText(candidate.insert);
        setDismissed(candidate.insert);
    };

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

    // ✕ takes it out of `pi.inbox`; the agent never reads it. Answers whether it really went.
    const take = async (item: ClientQueued): Promise<boolean> => {
        const result = await withdrawQueued(Number(sessionId), item.id);

        if (result === "aborted") {
            return true;
        }

        toast.error(
            result === undefined
                ? "Could not take that message back"
                : "The agent is already reading that message",
        );

        return false;
    };

    // ✎ takes it out of the queue and puts it back in the composer, with its mode and files, to be changed
    // and sent again. A draft already there stays, and the message goes below it as one more paragraph.
    const edit = async (item: ClientQueued): Promise<void> => {
        if (!(await take(item))) {
            return;
        }

        const draft = composerDraft(sessionId).trim();
        const next = draft === "" ? item.text : `${draft}\n\n${item.text}`;

        if (draft !== "") {
            toast.info("Added below what you were writing");
        }

        setComposerDraft(sessionId, next);
        setText(next);
        setMode(item.mode);
        setFiles((current) => [...current, ...(item.files ?? []).map(pendingOf)]);
        field.current?.focus();
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

        for (const listener of sentListeners.current) {
            listener();
        }

        // A command is not a message: it never enters the transcript, and its arguments are not files.
        const command = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(body);
        const name = command?.[1];
        const args = command?.[2]?.trim() ?? "";

        if (name === "new" && args === "" && paths.length === 0) {
            setComposerDraft(sessionId, "");
            browse.current = null;
            setText("");
            onNewSession();

            return;
        }

        if (name === "compact" && paths.length === 0) {
            setComposerDraft(sessionId, "");
            browse.current = null;
            setText("");
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

        remember(sessionId, body);
        setComposerDraft(sessionId, "");
        browse.current = null;
        setText("");
        forget(files);
        setFiles(() => []);
        setMode((current) => (current === "interrupt" ? "steer" : current));
        void onSend(body, paths, busy ? mode : undefined);
    };

    return (
        <div>
            <Queued
                items={queued}
                onWithdraw={(item) => {
                    void take(item);
                }}
                onEdit={(item) => {
                    void edit(item);
                }}
            />

            <div className="mb-2 empty:hidden">{above}</div>

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
                {matches.length === 0 ? null : (
                    <ul className="rounded-control border-edge bg-panel absolute right-0 bottom-full left-0 mb-1.5 flex max-h-64 flex-col overflow-y-auto border p-1 shadow-lg">
                        {matches.map((candidate, index) => (
                            <li key={candidate.label}>
                                <button
                                    type="button"
                                    aria-current={index === marked}
                                    // Arrow keys move the mark past the visible part of the list: follow it.
                                    ref={
                                        index === marked
                                            ? (element) => {
                                                  element?.scrollIntoView({ block: "nearest" });
                                              }
                                            : undefined
                                    }
                                    // Keep focus in the textarea.
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                    }}
                                    onClick={() => {
                                        pick(candidate);
                                    }}
                                    className={`rounded-control hover:bg-raised flex w-full min-w-0 items-baseline gap-2 px-2 py-1.5 text-left ${
                                        index === marked ? "bg-raised" : ""
                                    }`}
                                >
                                    <span className="text-interface text-ink shrink-0 font-mono">
                                        {candidate.label}
                                    </span>
                                    <span className="text-meta text-faint min-w-0 truncate">
                                        {candidate.description}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <Attachments
                    files={files}
                    onRemove={(key) => {
                        forget(files.filter((file) => file.key === key));
                        setFiles((current) => current.filter((file) => file.key !== key));
                    }}
                />

                <textarea
                    rows={2}
                    ref={field}
                    value={text}
                    placeholder={
                        busy && how !== undefined
                            ? `${how.label}: ${how.hint}…`
                            : "Ask the agent to change something…"
                    }
                    className="text-prose text-ink placeholder:text-faint block [field-sizing:content] max-h-[10lh] min-h-[2lh] w-full resize-none overflow-y-auto bg-transparent outline-none"
                    onChange={(event) => {
                        const value = event.target.value;

                        setMarked(0);

                        browse.current = null;
                        setComposerDraft(sessionId, value);
                        setText(value);
                    }}
                    onKeyDown={(event) => {
                        const chosen = matches[Math.min(marked, matches.length - 1)];

                        if (chosen !== undefined && !event.nativeEvent.isComposing) {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault();
                                setMarked(
                                    (marked +
                                        (event.key === "ArrowDown" ? 1 : -1) +
                                        matches.length) %
                                        matches.length,
                                );

                                return;
                            }

                            if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                                event.preventDefault();
                                pick(chosen);

                                return;
                            }

                            if (event.key === "Escape") {
                                setDismissed(text);

                                return;
                            }
                        }

                        const up = event.key === "ArrowUp";
                        const down = event.key === "ArrowDown";

                        if (
                            (up || down) &&
                            !event.shiftKey &&
                            !event.altKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            !event.nativeEvent.isComposing
                        ) {
                            const box = event.currentTarget;
                            const { selectionStart, selectionEnd, value } = box;
                            const collapsed = selectionStart === selectionEnd;
                            // Only leave the text when the caret is on its first (up) or last (down) line.
                            const edge = up
                                ? !value.slice(0, selectionStart).includes("\n")
                                : !value.slice(selectionEnd).includes("\n");

                            if (collapsed && edge) {
                                const past = loadHistory(sessionId);
                                const state = browse.current;
                                let next: string | undefined;

                                if (up && past.length > 0) {
                                    const at = state === null ? past.length - 1 : state.at - 1;

                                    if (at >= 0) {
                                        browse.current = { at, draft: state?.draft ?? value };
                                        next = past[at];
                                    }
                                } else if (down && state !== null) {
                                    if (state.at + 1 < past.length) {
                                        browse.current = { ...state, at: state.at + 1 };
                                        next = past[state.at + 1];
                                    } else {
                                        browse.current = null;
                                        next = state.draft;
                                    }
                                }

                                if (next !== undefined) {
                                    event.preventDefault();
                                    setComposerDraft(sessionId, next);
                                    setText(next);
                                    // Put the caret at the end once React has applied the text.
                                    requestAnimationFrame(() => {
                                        box.setSelectionRange(next.length, next.length);
                                    });
                                } else if (up || state !== null) {
                                    event.preventDefault();
                                }
                            }
                        }

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
                        className={`text-interface flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 ${
                            menuOpen ? "bg-raised text-ink" : "text-muted hover:bg-raised"
                        }`}
                    >
                        <Sparkles className="text-accent size-3.5" />
                        <span className="max-w-[12rem] min-w-0 truncate font-mono">{model}</span>
                        {level === null ? null : (
                            <span className={`shrink-0 ${thinkingText(level)}`}>{level}</span>
                        )}
                        <ChevronDown className="size-3.5 shrink-0" />
                    </button>

                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <ComposerItems
                            session={session}
                            field={field}
                            setText={(value) => {
                                browse.current = null;
                                setComposerDraft(sessionId, value);
                                setText(value);
                            }}
                            onSent={onSent}
                        />
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
                                // Keep focus in the textarea so the phone keyboard stays put and the tap is not lost.
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                }}
                                title={busy ? (how?.label ?? "Send") : "Send"}
                                className={`bg-accent text-on-accent relative flex h-7 items-center justify-center gap-1 before:absolute before:-inset-2 before:content-[''] disabled:opacity-40 ${
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
