import { Check, ListFilter, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Empty } from "@/components/ui/empty.tsx";
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
                    className={`h-auto max-w-20 truncate border-0 px-0 py-0.5 font-sans ${TAG_TONE[tag.color]}`}
                >
                    {/* The name is its own box, because `truncate` clips a badge's anonymous text child
                        without an ellipsis; the badge keeps its own so `max-w-20` still wins. */}
                    <span className="truncate">{tag.name}</span>
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
        return <Empty className="px-2 py-1.5">No tags yet. Add them in Extensions.</Empty>;
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
            <span className={`size-2 shrink-0 ${TAG_DOT[tag.color]}`} />
            <span className="truncate">{tag.name}</span>
        </DropdownMenuItem>
    ));
}

/**
 * The tag filter of the sidebar's list: every session that carries at least one chosen tag. An icon
 * beside the archive button opens a checklist; it is drawn only when tags exist.
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
        <DropdownMenu modal={false}>
            <Hint
                label={
                    live.length === 0 ? "Filter by tag" : `Filtered by ${String(live.length)} tags`
                }
            >
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Filter by tag"
                        className={`relative ${live.length === 0 ? "" : "text-accent"}`}
                    >
                        <ListFilter className="size-4" />
                        {live.length === 0 ? null : (
                            <span className="bg-accent text-on-accent text-micro absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center leading-none">
                                {live.length}
                            </span>
                        )}
                    </Button>
                </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" className="w-56">
                {tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={live.includes(tag.id)}
                        // Stay open: choosing two tags should not mean opening the menu twice.
                        onSelect={(event) => {
                            event.preventDefault();
                        }}
                        onCheckedChange={(on) => {
                            setChosen((held) =>
                                on ? [...held, tag.id] : held.filter((each) => each !== tag.id),
                            );
                        }}
                    >
                        <span className={`size-2 shrink-0 ${TAG_DOT[tag.color]}`} />
                        <span className="truncate">{tag.name}</span>
                    </DropdownMenuCheckboxItem>
                ))}
                {live.length === 0 ? null : (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                setChosen([]);
                            }}
                        >
                            <X />
                            Show every tag
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default {
    sessionRow: [{ id: "tags", component: SessionTags }],
    sessionFilter: [{ id: "tags", component: TagFilter }],
    sessionMenu: [{ id: "tags", label: "Tags", icon: <Tag />, submenu: TagsMenu }],
} satisfies WebExtension;
