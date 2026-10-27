import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { type AutoNameSettings, setAuto, settings } from "./refs.ts";

/** Whether a settled run names its session. Off until it is turned on here. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const [state, setState] = useState<AutoNameSettings | null>(null);
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
                    setError(cause instanceof Error ? cause.message : "Could not load the setting");
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, [active]);

    async function toggle(auto: boolean) {
        setSaving(true);

        try {
            setState(await callAction(setAuto, { auto }, null));
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save");
        } finally {
            setSaving(false);
        }
    }

    if (!active) {
        return <p className="text-faint text-meta">Turn the extension on to name sessions.</p>;
    }

    return (
        <div className="text-meta flex flex-col gap-2">
            {error === null ? null : (
                <p role="alert" className="text-danger break-words">
                    {error}
                </p>
            )}
            <div className="flex items-center gap-2">
                <span id="auto-name-after-run" className="text-ink">
                    Name a session when its run ends
                </span>
                <Switch
                    aria-labelledby="auto-name-after-run"
                    className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                    disabled={state === null || saving}
                    checked={state?.auto === true}
                    onCheckedChange={(auto) => {
                        void toggle(auto);
                    }}
                />
            </div>
            <p className="text-faint">
                Off by default, so a session keeps the name its first question gives it. A name set
                by hand is never replaced. The menu on a session row names it either way.
            </p>
        </div>
    );
}
