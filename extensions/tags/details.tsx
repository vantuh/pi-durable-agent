import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Hint } from "@/components/ui/tooltip.tsx";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { createTag, load, recolorTag, removeTag, renameTag, useTags } from "./client.ts";
import { MAX_NAME, TAG_COLORS, type TagColor, type TagsState } from "./refs.ts";
import { TAG_DOT } from "./tones.ts";

function sessionsWith(state: TagsState, tag: string): number {
    return Object.values(state.sessions).filter((held) => held.includes(tag)).length;
}

function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : "Something went wrong.";
}

/** The hues, as the dots that pick one; the chosen one is ringed, the rest wait their turn. */
function Swatches({
    value,
    onPick,
    disabled,
}: {
    value: TagColor;
    onPick: (color: TagColor) => void;
    disabled: boolean;
}) {
    return (
        <span className="flex flex-wrap items-center gap-1.5">
            {TAG_COLORS.map((color) => (
                <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={color === value}
                    title={color}
                    disabled={disabled}
                    onClick={() => {
                        onPick(color);
                    }}
                    className={`size-4 rounded-full ${TAG_DOT[color]} ${
                        color === value ? "ring-ink ring-2" : "opacity-50 hover:opacity-100"
                    }`}
                />
            ))}
        </span>
    );
}

/** The tags, made, coloured and dropped here; a session's own menu is where they are put on. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const state = useTags();
    const [name, setName] = useState("");
    const [color, setColor] = useState<TagColor>("mauve");
    const [editing, setEditing] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
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
            await createTag(wanted, color);
            setName("");
            // The next tag starts on the next hue, so a list of them is not one colour.
            setColor(TAG_COLORS[(TAG_COLORS.indexOf(color) + 1) % TAG_COLORS.length] ?? "mauve");
        });
    };

    return (
        <div className="text-meta flex flex-col gap-2">
            {error === null ? null : (
                <p role="alert" className="text-danger break-words">
                    {error}
                </p>
            )}
            <form onSubmit={add} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
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
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-faint">Colour</span>
                    <Swatches value={color} onPick={setColor} disabled={busy} />
                </div>
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
                            <li key={tag.id} className="flex min-h-6 items-center gap-2 py-0.5">
                                {editing === tag.id ? (
                                    <Swatches
                                        value={tag.color}
                                        disabled={busy}
                                        onPick={(next) => {
                                            void run(async () => {
                                                await recolorTag(tag.id, next);
                                                setEditing(null);
                                            });
                                        }}
                                    />
                                ) : (
                                    <Hint label="Change the colour">
                                        <button
                                            type="button"
                                            aria-label={`Colour of ${tag.name}`}
                                            disabled={busy}
                                            onClick={() => {
                                                setRenaming(null);
                                                setEditing(tag.id);
                                            }}
                                            className={`size-3 shrink-0 rounded-full ${TAG_DOT[tag.color]}`}
                                        />
                                    </Hint>
                                )}
                                {renaming?.id === tag.id ? (
                                    <form
                                        className="flex min-w-0 flex-1 items-center gap-1"
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            const wanted = renaming.name;

                                            void run(async () => {
                                                await renameTag(tag.id, wanted);
                                                setRenaming(null);
                                            });
                                        }}
                                    >
                                        <Input
                                            value={renaming.name}
                                            aria-label={`New name for ${tag.name}`}
                                            maxLength={MAX_NAME}
                                            disabled={busy}
                                            ref={(node) => {
                                                node?.focus();
                                            }}
                                            onChange={(event) => {
                                                setRenaming({
                                                    id: tag.id,
                                                    name: event.target.value,
                                                });
                                            }}
                                            className="h-6 py-0"
                                        />
                                        <Button
                                            type="submit"
                                            disabled={busy || renaming.name.trim() === ""}
                                            className="text-meta px-2 py-0.5"
                                        >
                                            Save
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setRenaming(null);
                                            }}
                                            className="shrink-0 px-1 py-0"
                                        >
                                            Cancel
                                        </Button>
                                    </form>
                                ) : (
                                    <span className="text-ink min-w-0 flex-1 truncate">
                                        {tag.name}
                                    </span>
                                )}
                                {count === 0 ? null : (
                                    <span className="text-faint shrink-0" title="Sessions with it">
                                        {count}
                                    </span>
                                )}
                                <Hint label="Rename">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Rename ${tag.name}`}
                                        disabled={busy}
                                        onClick={() => {
                                            setEditing(null);
                                            setRenaming({ id: tag.id, name: tag.name });
                                        }}
                                        className="text-muted shrink-0"
                                    >
                                        <Pencil className="size-3.5" />
                                    </Button>
                                </Hint>
                                <Hint label={`Delete ${tag.name}`}>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Delete ${tag.name}`}
                                        disabled={busy}
                                        onClick={() => {
                                            void run(async () => {
                                                await removeTag(tag.id);
                                            });
                                        }}
                                        className="text-muted hover:text-danger shrink-0"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </Hint>
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
