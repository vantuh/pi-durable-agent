import { Check, Tag } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu.tsx";
import { toast } from "@/lib/toast.ts";
import type { SessionItemProps, WebExtension } from "@/sdk/types.ts";

import { toggleTag, useTags } from "./client.ts";
import { tagsOf } from "./refs.ts";

/** How many names a row shows before it counts the rest: a row also has a title and a time to hold. */
const SHOWN = 1;

function SessionTags({ session }: SessionItemProps) {
    const names = tagsOf(useTags(), session.id).map((tag) => tag.name);

    if (names.length === 0) {
        return null;
    }

    const shown = names.slice(0, SHOWN);

    return (
        <span className="flex min-w-0 shrink items-center gap-1">
            {shown.map((name) => (
                <span
                    key={name}
                    title={name}
                    className="rounded-control bg-raised text-muted text-meta max-w-20 truncate px-1 py-0.5"
                >
                    {name}
                </span>
            ))}
            {names.length === shown.length ? null : (
                <span
                    className="text-faint text-meta shrink-0"
                    title={names.slice(SHOWN).join(", ")}
                >
                    +{names.length - shown.length}
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
            <span className="truncate">{tag.name}</span>
        </DropdownMenuItem>
    ));
}

export default {
    sessionRow: [{ id: "tags", component: SessionTags }],
    sessionMenu: [{ id: "tags", label: "Tags", icon: <Tag />, submenu: TagsMenu }],
} satisfies WebExtension;
