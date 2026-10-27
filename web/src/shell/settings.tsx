import { RotateCw, X } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

import { useSettingsSections } from "../extensions.ts";
import { restartServer } from "../lib/api.ts";
import { toast } from "../lib/toast.ts";
import type { SettingsProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";
import { AppearanceButton } from "./appearance-dialog.tsx";
import { ExtensionsButton } from "./extensions-dialog.tsx";

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
                <div className="divide-edge-soft flex flex-col divide-y">
                    <section className="flex flex-col gap-1.5 p-3">
                        <h3 className="text-meta text-faint">Session</h3>
                        <Row label="model" value={model} />
                        <Row label="folder" value={cwd} />
                    </section>

                    {sections.map(({ folder, id, title, component: Section }) => (
                        <section key={`${folder}:${id}`} className="flex flex-col gap-1.5 p-3">
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
                <RestartButton />
            </footer>
        </aside>
    );
}

/** Starts a new server process; running work resumes, and the event stream reconnects on its own. */
function RestartButton() {
    return (
        <button
            type="button"
            title="Restart the server: running work resumes"
            aria-label="Restart the server"
            className="rounded-control text-muted hover:bg-raised focus-visible:ring-accent ml-auto flex size-7 items-center justify-center outline-none focus-visible:ring-2"
            onClick={() => {
                void restart();
            }}
        >
            <RotateCw className="size-4" />
        </button>
    );
}

async function restart(): Promise<void> {
    try {
        await restartServer();
        toast.info("Restarting. Running work continues after the restart.");
    } catch {
        toast.error("Could not restart. Start the app with pnpm dev or pnpm start.");
    }
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="text-meta text-faint shrink-0">{label}</span>
            <span className="text-meta text-muted min-w-0 truncate font-mono">{value}</span>
        </div>
    );
}
