import { useHeaderItems } from "../extensions.ts";
import type { StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export function HeaderItems({ session }: StatusProps) {
    return useHeaderItems().map(({ folder, id, component: Item }) => (
        <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
            <Item session={session} />
        </ItemBoundary>
    ));
}
