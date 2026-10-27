import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { PROVIDERS, SETTINGS_CHANGED, setShown, settings, type Settings } from "./refs.ts";

/** Which providers the status bar item and its popover show. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const [state, setState] = useState<Settings | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        let alive = true;

        void (async () => {
            try {
                const found = await callAction(settings, undefined, null);

                if (alive) {
                    setState(found);
                    setError(null);
                }
            } catch (cause) {
                if (alive) {
                    setError(cause instanceof Error ? cause.message : "Could not load settings");
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, [active]);

    async function toggle(id: string, shown: boolean) {
        setSaving(true);

        try {
            setState(await callAction(setShown, { id, shown }, null));
            setError(null);
            window.dispatchEvent(new Event(SETTINGS_CHANGED));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save");
        } finally {
            setSaving(false);
        }
    }

    if (!active) {
        return <p className="text-faint text-meta">Turn the extension on to choose providers.</p>;
    }

    return (
        <div className="text-meta flex flex-col gap-2">
            {error === null ? null : (
                <p role="alert" className="text-danger break-words">
                    {error}
                </p>
            )}
            <p className="text-faint">
                Providers to show. A hidden provider is not asked for its limits.
            </p>
            {PROVIDERS.map((provider) => (
                <div key={provider.id} className="flex items-center gap-2 pl-3">
                    <span id={`usage-${provider.id}`} className="text-ink w-28">
                        {provider.name}
                    </span>
                    <Switch
                        aria-labelledby={`usage-${provider.id}`}
                        className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                        disabled={state === null || saving}
                        checked={state !== null && !state.hidden.includes(provider.id)}
                        onCheckedChange={(shown) => {
                            void toggle(provider.id, shown);
                        }}
                    />
                </div>
            ))}
        </div>
    );
}
