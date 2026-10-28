import { useAboveComposerItems } from "../extensions.ts";
import type { AboveComposerProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export function AboveComposerItems(props: AboveComposerProps) {
    return useAboveComposerItems().map(({ folder, id, component: Item }) => (
        <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
            <Item {...props} />
        </ItemBoundary>
    ));
}
