import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { createTag, load, removeTag, useTags } from "./client.ts";
import { MAX_NAME, type TagsState } from "./refs.ts";

function sessionsWith(state: TagsState, tag: string): number {
    return Object.values(state.sessions).filter((held) => held.includes(tag)).length;
}

function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : "Something went wrong.";
}

/** The tags, made and dropped here; a session's own menu is where they are put on. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const state = useTags();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // `useTags` swallows a failed read, because a row has nothing to say about one; here it is said.
    useEffect(() => {
        if (!active) {
            return;
        }

        void load().catch((cause: unknown) => {
            setError(messageOf(cause));
        });
    }, [active]);

    const run = async (work: () => Promise<void>): Promise<void> => {
        setBusy(true);

        try {
            await work();
            setError(null);
        } catch (cause) {
            setError(messageOf(cause));
        } finally {
            setBusy(false);
        }
    };

    if (!active) {
        return <p className="text-faint text-meta">Turn the extension on to tag sessions.</p>;
    }

    const add = (event: FormEvent): void => {
        event.preventDefault();
        const wanted = name.trim();

        if (wanted === "") {
            return;
        }

        void run(async () => {
            await createTag(wanted);
            setName("");
        });
    };

    return (
        <div className="text-meta flex flex-col gap-2">
            {error === null ? null : (
                <p role="alert" className="text-danger break-words">
                    {error}
                </p>
            )}
            <form onSubmit={add} className="flex items-center gap-2">
                <Input
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                    aria-label="Tag name"
                    placeholder="Tag name"
                    maxLength={MAX_NAME}
                    disabled={busy}
                />
                <Button type="submit" disabled={busy || name.trim() === ""}>
                    Add
                </Button>
            </form>
            {state === undefined ? (
                <p className="text-faint">Loading…</p>
            ) : state.tags.length === 0 ? (
                <p className="text-faint">No tags yet.</p>
            ) : (
                <ul className="flex flex-col">
                    {state.tags.map((tag) => {
                        const count = sessionsWith(state, tag.id);

                        return (
                            <li key={tag.id} className="flex items-center gap-2 py-0.5">
                                <span className="text-ink min-w-0 flex-1 truncate">{tag.name}</span>
                                {count === 0 ? null : (
                                    <span className="text-faint shrink-0" title="Sessions with it">
                                        {count}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    aria-label={`Delete ${tag.name}`}
                                    title={`Delete ${tag.name}`}
                                    disabled={busy}
                                    onClick={() => {
                                        void run(async () => {
                                            await removeTag(tag.id);
                                        });
                                    }}
                                    className="text-muted hover:text-danger shrink-0"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="text-faint">
                Tags live on the server, so every device sees them. Deleting one takes it off every
                session that had it. A session's menu puts them on.
            </p>
        </div>
    );
}
