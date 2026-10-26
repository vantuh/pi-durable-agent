import { X } from "lucide-react";

import type { FolderPanel } from "../extensions.ts";
import type { PanelProps } from "../sdk/types.ts";
import { ItemBoundary } from "./item-boundary.tsx";

export const panelKey = (panel: FolderPanel): string => `${panel.folder}:${panel.id}`;

/** One header button per panel; the open one stays raised. */
export function PanelButtons({
    panels,
    open,
    onToggle,
}: {
    panels: readonly FolderPanel[];
    open: string | null;
    onToggle: (key: string) => void;
}) {
    return panels.map((panel) => {
        const key = panelKey(panel);

        return (
            <button
                key={key}
                type="button"
                title={panel.title}
                onClick={() => {
                    onToggle(key);
                }}
                className={`rounded-control hover:bg-raised hover:text-ink flex size-6 items-center justify-center ${open === key ? "bg-raised text-ink" : "text-muted"}`}
            >
                {panel.icon}
            </button>
        );
    });
}

/**
 * The open panel, to the right of the conversation. Below `lg` it covers the screen, as the
 * sessions list does. The body is the extension's own; the frame and the close button are ours.
 */
export function PanelHost({
    panel,
    session,
    onClose,
}: PanelProps & {
    panel: FolderPanel;
}) {
    const Body = panel.component;

    return (
        <aside className="rounded-card border-edge-soft bg-canvas fixed inset-2 z-20 flex min-w-0 flex-col border lg:static lg:inset-auto lg:z-auto lg:w-[min(46%,720px)] lg:shrink-0">
            <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">{panel.title}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close"
                    className="rounded-control text-muted hover:bg-raised flex size-6 items-center justify-center"
                >
                    <X className="size-4" />
                </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
                <ItemBoundary name={panelKey(panel)}>
                    <Body session={session} onClose={onClose} />
                </ItemBoundary>
            </div>
        </aside>
    );
}
