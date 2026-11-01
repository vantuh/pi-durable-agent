import { memo } from "react";

import { useHeaderItems } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

/** What extensions put in the conversation's header. A frame of the reply above it does not change any of them. */
export const HeaderItems = memo(function HeaderItems({ session }: StatusProps) {
    return useHeaderItems().map(({ folder, id, component: Item }) => (
        <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
            <Item session={session} />
        </ItemBoundary>
    ));
});
