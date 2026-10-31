import { type ComponentProps, lazy, Suspense } from "react";

import type { ModelMenu as ModelMenuDialog } from "./model-menu-dialog.tsx";

// cmdk is only for this dialog; fetched when the menu opens, not at boot.
const Dialog = lazy(async () => ({
    default: (await import("./model-menu-dialog.tsx")).ModelMenu,
}));

export function ModelMenu(props: ComponentProps<typeof ModelMenuDialog>) {
    return (
        <Suspense fallback={null}>
            <Dialog {...props} />
        </Suspense>
    );
}
