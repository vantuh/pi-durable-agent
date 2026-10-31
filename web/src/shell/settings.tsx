import { lazy, Suspense } from "react";

import type { Props } from "./settings-content.tsx";

// The contents (and the dialogs behind their buttons) are fetched at the first open, not at boot.
const Content = lazy(async () => ({
    default: (await import("./settings-content.tsx")).SettingsContent,
}));

export function Settings({ open, ...props }: Props) {
    return (
        <aside
            data-open={open ? "" : undefined}
            className="rounded-card border-edge-soft bg-canvas invisible fixed inset-2 z-20 flex min-w-0 shrink-0 justify-end overflow-hidden border transition-[translate,visibility] duration-200 ease-out data-[open]:pointer-events-auto data-[open]:visible motion-reduce:transition-none max-lg:translate-x-[calc(100%+8px)] max-lg:data-[open]:translate-x-0 lg:relative lg:inset-auto lg:z-auto lg:w-0 lg:transition-[width,visibility] lg:data-[open]:w-[360px]"
        >
            {/* Nothing is fetched until the first open; it then stays, so the closing panel still has content. */}
            {props.epoch === 0 ? null : (
                <Suspense fallback={null}>
                    <Content {...props} />
                </Suspense>
            )}
        </aside>
    );
}
