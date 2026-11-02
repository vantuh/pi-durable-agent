import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { callAction } from "@/sdk/actions.ts";
import type { PanelProps } from "@/sdk/types.ts";

import { type Note, read, write } from "./refs.ts";
import { flushed, trackFlush } from "./store.ts";
import { Todos } from "./todos.tsx";

const DEBOUNCE_MS = 600;

type State = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

const LABEL: Record<State, string> = {
    loading: "Loading…",
    saved: "Saved",
    dirty: "Unsaved",
    saving: "Saving…",
    conflict: "Changed elsewhere",
    error: "Not saved",
};

const messageOf = (failure: unknown, fallback: string): string =>
    failure instanceof Error ? failure.message : fallback;

type Memory = { latest: string; disk: Note; conflicted: boolean };

/** Writes `memory.latest` until the disk holds it, or the disk turns out to have changed meanwhile. */
async function persist(
    id: number,
    memory: Memory,
    report: {
        saving: () => void;
        saved: () => void;
        conflict: (note: Note) => void;
        failed: (failure: unknown) => void;
    },
): Promise<void> {
    try {
        while (!memory.conflicted && memory.latest !== memory.disk.text) {
            const sent = memory.latest;

            report.saving();
            const result = await callAction(write, { text: sent, base: memory.disk.version }, id);

            if (result.conflict) {
                memory.conflicted = true;
                report.conflict({ text: result.text, version: result.version });

                return;
            }

            memory.disk = { text: sent, version: result.version };
        }

        if (!memory.conflicted) {
            report.saved();
        }
    } catch (failure) {
        report.failed(failure);
    }
}

/**
 * The note of one session's repository, with its autosave. `disk` is what the server last said the
 * file holds; the text is dirty while it differs, and a write names the version it was based on.
 */
function useNote(id: number) {
    const [text, setText] = useState("");
    const [state, setState] = useState<State>("loading");
    const [other, setOther] = useState<Note | null>(null);
    const [error, setError] = useState<string | null>(null);
    const memory = useRef<Memory>({
        latest: "",
        disk: { text: "", version: "" },
        conflicted: false,
    });
    const flight = useRef<Promise<void> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const show = useCallback((note: Note) => {
        memory.current.disk = note;
        memory.current.latest = note.text;
        memory.current.conflicted = false;
        setText(note.text);
        setOther(null);
        setError(null);
        setState("saved");
    }, []);

    const save = useCallback((): Promise<void> => {
        clearTimeout(timer.current);

        if (flight.current !== null) {
            return flight.current;
        }

        const started = persist(id, memory.current, {
            saving: () => {
                setState("saving");
            },
            saved: () => {
                setError(null);
                setState("saved");
            },
            conflict: (note) => {
                setOther(note);
                setState("conflict");
            },
            failed: (failure) => {
                setError(messageOf(failure, "The note was not saved."));
                setState("error");
            },
        });

        flight.current = started.finally(() => {
            flight.current = null;
        });

        return flight.current;
    }, [id]);

    useEffect(() => {
        let alive = true;
        // Only a note with no local edits is replaced; an edited one meets the disk through a write.
        const clean = (): boolean =>
            flight.current === null && memory.current.latest === memory.current.disk.text;
        const refresh = async (): Promise<void> => {
            // A remount (StrictMode, or switching tabs back) starts while the unmount's save runs.
            if (flight.current !== null) {
                await flight.current;
            }

            if (!clean()) {
                return;
            }

            try {
                await flushed();

                // A read that lands after a save of ours describes an older disk: drop it.
                const seen = memory.current.disk;
                const note = await callAction(read, undefined, id);

                if (
                    alive &&
                    note !== null &&
                    memory.current.disk === seen &&
                    clean() &&
                    note.version !== seen.version
                ) {
                    show(note);
                }
            } catch (failure) {
                if (alive) {
                    setError(messageOf(failure, "The note could not be read."));
                    setState("error");
                }
            }
        };
        const onFocus = (): void => {
            void refresh();
        };

        void refresh();
        window.addEventListener("focus", onFocus);

        return () => {
            alive = false;
            window.removeEventListener("focus", onFocus);

            trackFlush(save());
        };
    }, [id, save, show]);

    return {
        text,
        state,
        other,
        error,
        edit: (value: string) => {
            memory.current.latest = value;
            setText(value);

            if (!memory.current.conflicted) {
                setState("dirty");
                clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                    void save();
                }, DEBOUNCE_MS);
            }
        },
        loadNewer: () => {
            if (other !== null) {
                show(other);
            }
        },
        overwrite: () => {
            if (other !== null) {
                memory.current.disk = other;
                memory.current.conflicted = false;
                setOther(null);
                void save();
            }
        },
    };
}

export function NotesPanel({ session }: PanelProps) {
    const [tab, setTab] = useState("todos");

    if (session === null || session.cwd === null) {
        return <Empty className="text-interface p-3">This session has no folder.</Empty>;
    }

    const tabs = (
        <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
                <TabsTrigger value="todos">To-dos</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
        </Tabs>
    );

    return tab === "todos" ? (
        <Todos id={session.id} tabs={tabs} />
    ) : (
        <Notes id={session.id} tabs={tabs} />
    );
}

function Notes({ id, tabs }: { id: number; tabs: ReactNode }) {
    const note = useNote(id);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-edge-soft text-meta flex items-center justify-between gap-2 border-b px-3 py-1.5">
                {tabs}
                <span
                    title={note.error ?? undefined}
                    className={
                        note.state === "conflict" || note.state === "error"
                            ? "text-danger"
                            : "text-faint"
                    }
                >
                    {LABEL[note.state]}
                </span>
            </div>
            {note.other === null ? null : (
                <div className="border-edge-soft text-interface flex flex-col gap-2 border-b px-3 py-2">
                    <p className="text-ink">This note changed on another device or tab.</p>
                    <div className="flex gap-2">
                        <Button variant="ghost" className="font-medium" onClick={note.loadNewer}>
                            Load newer
                        </Button>
                        <Button onClick={note.overwrite}>Overwrite with mine</Button>
                    </div>
                </div>
            )}

            {note.state === "error" && note.error !== null ? (
                <Alert className="text-interface rounded-none">{note.error}</Alert>
            ) : null}

            <Textarea
                value={note.text}
                disabled={note.state === "loading"}
                spellCheck={false}
                placeholder="Notes for this repository."
                onChange={(event) => {
                    note.edit(event.target.value);
                }}
                className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-3 py-2 focus-visible:ring-0"
            />
        </div>
    );
}
