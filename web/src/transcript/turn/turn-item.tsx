import { memo } from "react";

import { sameItem } from "@/lib/turn-equality.ts";
import type { Item } from "@/lib/turns.ts";
import { Markdown } from "@/ui/markdown.tsx";

import { ActivityGroup } from "../activity/activity-group.tsx";
import { ErrorNotice } from "./error-notice.tsx";

function TurnItemView({ item }: { item: Item }) {
    if (item.type === "activity") {
        return <ActivityGroup item={item} />;
    }

    if (item.type === "error") {
        return <ErrorNotice text={item.text} />;
    }

    // Marked here and nowhere else: a selection inside an answer is what the Quote button follows.
    return (
        <div data-quoteable>
            <Markdown text={item.text} streaming={item.streaming} />
        </div>
    );
}

/**
 * One thing a turn shows. A frame of a streamed reply rebuilds every item of the turn it lands in, and only the one
 * holding that reply differs: the rest compares equal and does not render at all.
 */
export const TurnItem = memo(TurnItemView, (before, after) => sameItem(before.item, after.item));
