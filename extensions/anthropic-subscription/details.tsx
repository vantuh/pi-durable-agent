import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";

import { DEFAULT_VERSION, type Diagnostics, diagnostics, outcomes } from "./refs.ts";

export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const [state, setState] = useState<Diagnostics | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        async function update(): Promise<void> {
            try {
                const found = await callAction(diagnostics, undefined, null);
                if (alive) {
                    setState(found);
                    setError(null);
                }
            } catch (cause) {
                if (alive) {
                    setError(cause instanceof Error ? cause.message : "Could not load diagnostics");
                }
            }
            if (alive) {
                timer = setTimeout(() => {
                    void update();
                }, 3000);
            }
        }
        void update();
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [active]);

    return (
        <div className="text-meta flex flex-col gap-2">
            {active ? (
                <>
                    {error === null ? null : (
                        <p role="alert" className="text-danger break-words">
                            {error}
                        </p>
                    )}
                    {state === null ? (
                        <p className="text-faint">
                            {error === null ? "Loading diagnostics…" : "Diagnostics unavailable."}
                        </p>
                    ) : (
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                            <dt className="text-faint">Billing version</dt>
                            <dd className="text-ink text-right font-mono">{state.version}</dd>
                            <dt className="text-faint">Version source</dt>
                            <dd className="text-muted text-right">
                                {state.source === "default"
                                    ? "Default"
                                    : state.source === "environment"
                                      ? "Environment variable"
                                      : "Pi transport"}
                            </dd>
                            <dt className="text-faint">Pi User-Agent version</dt>
                            <dd className="text-muted text-right font-mono">
                                {state.transportVersion ?? "Not observed yet"}
                            </dd>
                            <dt className="text-faint">Last request</dt>
                            <dd className="text-muted text-right">
                                {state.last === null
                                    ? "No requests yet"
                                    : outcomes[state.last.outcome]}
                            </dd>
                            {state.last === null ? null : (
                                <>
                                    <dt className="text-faint">Provider</dt>
                                    <dd className="text-muted text-right break-all">
                                        {state.last.provider}
                                    </dd>
                                    <dt className="text-faint">Time</dt>
                                    <dd className="text-muted text-right">
                                        {new Date(state.last.at).toLocaleString()}
                                    </dd>
                                </>
                            )}
                        </dl>
                    )}
                    {error !== null && state !== null ? (
                        <p className="text-faint">
                            Values above are from the last successful refresh.
                        </p>
                    ) : null}
                </>
            ) : (
                <>
                    <p className="text-muted">
                        {enabled ? "Extension not installed." : "Extension disabled."} Live
                        diagnostics unavailable.
                    </p>
                    <p className="text-faint">
                        Bundled default: <span className="font-mono">{DEFAULT_VERSION}</span>. The
                        configured version is available only while enabled.
                    </p>
                </>
            )}
            <p className="text-faint">
                Billing version follows the newer of the default and Pi's observed User-Agent
                version, unless overridden. Diagnostics cover all sessions and reset on reload or
                disable.
            </p>
            <p className="text-faint">
                Shaping does not confirm that a request was charged to subscription limits.
            </p>
        </div>
    );
}
