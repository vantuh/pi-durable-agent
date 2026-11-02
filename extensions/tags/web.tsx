import { Check, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu.tsx";
import { Hint } from "@/components/ui/tooltip.tsx";
import { toast } from "@/lib/toast.ts";
import type { SessionFilterProps, SessionItemProps, WebExtension } from "@/sdk/types.ts";

import { toggleTag, useTags } from "./client.ts";
import { tagsOf } from "./refs.ts";
import { TAG_DOT, TAG_TONE } from "./tones.ts";

/** How many names a row shows before it counts the rest: a row also has a title and a time to hold. */
const SHOWN = 1;

function SessionTags({ session }: SessionItemProps) {
    const tags = tagsOf(useTags(), session.id);

    if (tags.length === 0) {
        return null;
    }

    const shown = tags.slice(0, SHOWN);

    return (
        <span className="flex min-w-0 shrink items-center gap-1">
            {shown.map((tag) => (
                <Badge
                    key={tag.id}
                    title={tag.name}
                    className={`rounded-control h-auto max-w-20 truncate border-0 px-1 py-0.5 font-sans ${TAG_TONE[tag.color]}`}
                >
                    {tag.name}
                </Badge>
            ))}
            {tags.length === shown.length ? null : (
                <span
                    className="text-faint text-meta shrink-0"
                    title={tags
                        .slice(SHOWN)
                        .map((tag) => tag.name)
                        .join(", ")}
                >
                    +{tags.length - shown.length}
                </span>
            )}
        </span>
    );
}

function TagsMenu({ session }: SessionItemProps) {
    const state = useTags();
    const tags = state?.tags ?? [];
    const held = new Set(state?.sessions[String(session.id)] ?? []);

    if (tags.length === 0) {
        return (
            <p className="text-faint text-meta px-2 py-1.5">No tags yet. Add them in Extensions.</p>
        );
    }

    return tags.map((tag) => (
        <DropdownMenuItem
            key={tag.id}
            onSelect={(event) => {
                // Stay open: putting three tags on a session should not mean opening the menu three times.
                event.preventDefault();
                void toggleTag(tag.id, session.id).catch((error: unknown) => {
                    toast.error(
                        error instanceof Error ? error.message : "Could not change the tag.",
                    );
                });
            }}
        >
            <Check className={held.has(tag.id) ? "size-4" : "size-4 opacity-0"} />
            <span className={`size-2 shrink-0 rounded-full ${TAG_DOT[tag.color]}`} />
            <span className="truncate">{tag.name}</span>
        </DropdownMenuItem>
    ));
}

/**
 * The tag filter of the sidebar's list: every session that carries at least one chosen tag. The chips
 * are the control, so they are drawn whether or not anything is chosen, and only when tags exist.
 */
function TagFilter({ setMatch }: SessionFilterProps) {
    const state = useTags();
    const tags = state?.tags ?? [];
    const [chosen, setChosen] = useState<readonly string[]>([]);
    // A tag dropped in the settings stops filtering, so the list cannot be emptied by a tag that is gone.
    const live = chosen.filter((id) => tags.some((tag) => tag.id === id));
    const signature = live.join(" ");

    useEffect(() => {
        if (live.length === 0) {
            setMatch(null);

            return;
        }

        const wanted = new Set(live);

        setMatch((session) => tagsOf(state, session.id).some((tag) => wanted.has(tag.id)));
        // `live` and `state` are rebuilt every render; the signature is what says the answer moved.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, state, setMatch]);

    if (tags.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-1 px-3 py-2">
            {tags.map((tag) => {
                const on = live.includes(tag.id);

                return (
                    <Hint
                        key={tag.id}
                        label={
                            on ? `${tag.name}: shown, click to stop` : `${tag.name}: click to show`
                        }
                    >
                        {/* A wash of the tag's own hue is the pill, and it stays on hover: ghost's raised fill
                            would replace it. The focus ring is the app's, not the browser's. */}
                        <Badge
                            asChild
                            className={`rounded-control focus-visible:ring-accent h-auto max-w-24 min-w-0 gap-0.5 border-0 px-1.5 py-0.5 font-sans outline-none hover:brightness-110 focus-visible:ring-2 [&>svg]:size-2.5 ${TAG_TONE[tag.color]}`}
                        >
                            <button
                                type="button"
                                aria-pressed={on}
                                onClick={() => {
                                    setChosen((held) =>
                                        held.includes(tag.id)
                                            ? held.filter((each) => each !== tag.id)
                                            : [...held, tag.id],
                                    );
                                }}
                            >
                                <span className="truncate">{tag.name}</span>
                                {on ? <X aria-hidden /> : null}
                            </button>
                        </Badge>
                    </Hint>
                );
            })}
            {live.length === 0 ? null : (
                <Hint label="Show every tag">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Show every tag"
                        onClick={() => {
                            setChosen([]);
                        }}
                        className="shrink-0 px-1 py-0 underline-offset-2 hover:underline"
                    >
                        clear
                    </Button>
                </Hint>
            )}
        </div>
    );
}

export default {
    sessionRow: [{ id: "tags", component: SessionTags }],
    sessionFilter: [{ id: "tags", component: TagFilter }],
    sessionMenu: [{ id: "tags", label: "Tags", icon: <Tag />, submenu: TagsMenu }],
} satisfies WebExtension;
