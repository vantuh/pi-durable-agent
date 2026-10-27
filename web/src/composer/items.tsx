import { useComposerItems } from "../extensions.ts";
import type { ComposerProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export function ComposerItems(props: ComposerProps) {
    return useComposerItems().map(({ folder, id, component: Item }) => (
        <ItemBoundary key={`${folder}:${id}`} name={`${folder}:${id}`}>
            <Item {...props} />
        </ItemBoundary>
    ));
}
