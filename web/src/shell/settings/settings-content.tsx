import { Hammer, LoaderCircle, RotateCw } from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { useSettingsSections } from "@/extensions.ts";
import { rebuildShell, restartServer } from "@/lib/api.ts";
import { toast } from "@/lib/toast.ts";
import type { SettingsProps } from "@/sdk/types.ts";
import { ItemBoundary } from "@/ui/item-boundary.tsx";

import { AppearanceButton } from "./appearance/appearance-button.tsx";
import { ExtensionsButton } from "./extensions-dialog.tsx";

export type Props = {
    model: string;
    cwd: string;
    session: SettingsProps["session"];
    open: boolean;
    onClose: () => void;
};

export function SettingsContent({ model, cwd, session }: Omit<Props, "open" | "onClose">) {
    const sections = useSettingsSections();

    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col">
                    <section className="flex flex-col gap-1.5 p-3">
                        <h3 className="text-meta text-faint">Session</h3>
                        <Row label="model" value={model} />
                        <Row label="folder" value={cwd} />
                    </section>

                    {/* The sheet is unmounted when closed, so each open reads the sections afresh. */}
                    {sections.map(({ folder, id, title, component: Section }) => (
                        <Fragment key={`${folder}:${id}`}>
                            <Separator />
                            <section className="flex flex-col gap-1.5 p-3">
                                <h3 className="text-meta text-faint">{title}</h3>
                                <ItemBoundary name={`${folder}:${id}`}>
                                    <Section session={session} />
                                </ItemBoundary>
                            </section>
                        </Fragment>
                    ))}
                </div>
            </ScrollArea>

            <footer className="border-edge-soft flex items-center gap-1 border-t px-3 py-2">
                <ExtensionsButton />
                <AppearanceButton />
                <RestartButton />
                <BuildButton />
            </footer>
        </div>
    );
}

/** Rebuilds `dist/` from this checkout; the shell is read from disk per request, so no restart follows. */
function BuildButton() {
    const [building, setBuilding] = useState(false);

    return (
        <Hint label={building ? "Building the web shell" : "Rebuild the web shell"}>
            <Button
                variant="ghost"
                size="icon"
                aria-label="Rebuild the web shell"
                aria-busy={building}
                aria-disabled={building}
                className="aria-disabled:opacity-50"
                onClick={() => {
                    if (building) {
                        return;
                    }

                    setBuilding(true);
                    void rebuild().finally(() => {
                        setBuilding(false);
                    });
                }}
            >
                {building ? (
                    <LoaderCircle className="size-4 animate-spin" />
                ) : (
                    <Hammer className="size-4" />
                )}
            </Button>
        </Hint>
    );
}

async function rebuild(): Promise<void> {
    try {
        const { ok, log } = await rebuildShell();

        if (ok) {
            toast.success("New build ready", {
                description: "Reload the app to load it.",
                action: {
                    label: "Reload",
                    onClick: () => {
                        window.location.reload();
                    },
                },
            });
        } else {
            toast.error("The build failed", { description: log.slice(0, 600) });
        }
    } catch {
        toast.error("Could not build. The server needs this checkout, with node_modules.");
    }
}

/** Starts a new server process; running work resumes, and the event stream reconnects on its own. */
function RestartButton() {
    return (
        <Hint label="Restart the server: running work resumes">
            <Button
                variant="ghost"
                size="icon"
                aria-label="Restart the server"
                className="ml-auto"
                onClick={() => {
                    void restart();
                }}
            >
                <RotateCw className="size-4" />
            </Button>
        </Hint>
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
