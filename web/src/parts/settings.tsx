import { X } from "lucide-react";

import { useSettingsSections } from "../extensions.ts";
import type { Flavour } from "../lib/flavour.ts";
import { FLAVOURS, applyFlavour } from "../lib/flavour.ts";
import type { SettingsProps } from "../sdk/types.ts";
import { ExtensionsButton } from "./extensions-dialog.tsx";
import { ItemBoundary } from "./item-boundary.tsx";

type Props = {
    flavour: Flavour;
    model: string;
    cwd: string;
    session: SettingsProps["session"];
    onFlavour: (flavour: Flavour) => void;
    onClose: () => void;
};

export function Settings({ flavour, model, cwd, session, onFlavour, onClose }: Props) {
    const sections = useSettingsSections();

    return (
        <aside className="rounded-card border-edge-soft bg-canvas flex w-[360px] shrink-0 flex-col border">
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

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
                <section className="flex flex-col gap-2">
                    <h3 className="text-meta text-faint">Flavour</h3>
                    <div className="grid grid-cols-2 gap-1.5">
                        {FLAVOURS.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => {
                                    applyFlavour(option);
                                    onFlavour(option);
                                }}
                                className={`rounded-control text-interface px-2 py-1.5 capitalize ${
                                    option === flavour
                                        ? "bg-accent text-on-accent"
                                        : "bg-raised text-ink"
                                }`}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </section>

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

            <footer className="border-edge-soft flex items-center border-t px-3 py-2">
                <ExtensionsButton />
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
