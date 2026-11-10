import { memo } from "react";

import { useHeaderItems } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

/** What extensions put in the conversation's header. A frame of the reply above it does not change any of them. */
export const HeaderItems = memo(function HeaderItems({
    session,
    openPage,
}: StatusProps & {
    /** Opens a page by its key (`folder:id`); each item gets it narrowed to its own folder. */
    openPage: (key: string, sub?: string) => void;
}) {
    // Lower first; the copy keeps the folders' order for equals, since the sort is stable.
    return [...useHeaderItems()]
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(({ folder, id, component: Item }) => (
            <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
                <Item
                    session={session}
                    openPage={(page, sub) => {
                        openPage(`${folder}:${page}`, sub);
                    }}
                />
            </ItemBoundary>
        ));
});
