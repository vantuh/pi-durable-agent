import { X } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

import { useSettingsSections } from "../extensions.ts";
import type { SettingsProps } from "../sdk/types.ts";
import { AppearanceButton } from "./appearance-dialog.tsx";
import { ExtensionsButton } from "./extensions-dialog.tsx";
import { ItemBoundary } from "./item-boundary.tsx";

type Props = {
    model: string;
    cwd: string;
    session: SettingsProps["session"];
    onClose: () => void;
};

export function Settings({ model, cwd, session, onClose }: Props) {
    const sections = useSettingsSections();

    return (
        <aside className="rounded-card border-edge-soft bg-canvas fixed inset-2 z-20 flex min-w-0 shrink-0 flex-col border lg:relative lg:inset-auto lg:z-auto lg:w-[360px]">
            <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">Settings</h2>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close"
                    className="rounded-control text-muted hover:bg-raised flex size-6 items-center justify-center"
                >
                    <X className="size-4" />
                </button>
            </header>

            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-3">
                    <section className="flex flex-col gap-1.5">
                        <h3 className="text-meta text-faint">Session</h3>
                        <Row label="model" value={model} />
                        <Row label="folder" value={cwd} />
                    </section>

                    {sections.map(({ folder, id, title, component: Section }) => (
                        <section key={`${folder}:${id}`} className="flex flex-col gap-1.5">
                            <h3 className="text-meta text-faint">{title}</h3>
                            <ItemBoundary name={`${folder}:${id}`}>
                                <Section session={session} />
                            </ItemBoundary>
                        </section>
                    ))}
                </div>
            </ScrollArea>

            <footer className="border-edge-soft flex items-center gap-1 border-t px-3 py-2">
                <ExtensionsButton />
                <AppearanceButton />
            </footer>
        </aside>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="text-meta text-faint shrink-0">{label}</span>
            <span className="text-meta text-muted min-w-0 truncate font-mono">{value}</span>
        </div>
    );
}
