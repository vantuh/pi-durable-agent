import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { SettingsProps, WebExtension } from "@/sdk/types.ts";

import { type McpState, state, toggle } from "./refs.ts";

function Servers(_props: SettingsProps) {
    const [current, setCurrent] = useState<McpState | undefined>();
    const [busy, setBusy] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const found = await callAction(state, undefined, null);

                if (alive) {
                    setCurrent(found);
                }
            } catch (failure) {
                if (alive) {
                    setError(
                        failure instanceof Error ? failure.message : "Cannot read the servers.",
                    );
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    const change = async (name: string, enabled: boolean) => {
        setBusy(name);
        setError(undefined);

        try {
            setCurrent(await callAction(toggle, { name, enabled }, null));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Something went wrong.");
        } finally {
            setBusy(undefined);
        }
    };

    if (current === undefined) {
        return error === undefined ? (
            <Spinner className="text-faint" />
        ) : (
            <p className="text-meta text-danger">{error}</p>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {current.problem === undefined ? null : (
                <p className="text-meta text-danger">{current.problem}</p>
            )}
            {current.servers.length === 0 && current.problem === undefined ? (
                <p className="text-meta text-muted">No servers in mcp.json.</p>
            ) : null}
            {current.servers.map((server) => (
                <div key={server.name} className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ink text-interface">{server.name}</span>
                        <span className="text-meta text-faint truncate font-mono">
                            {server.target}
                        </span>
                        <span
                            className={`text-meta ${server.status === "error" ? "text-danger" : "text-muted"}`}
                        >
                            {server.status === "connected"
                                ? `${server.tools} tools`
                                : server.status === "error"
                                  ? (server.error ?? "failed")
                                  : server.status === "connecting"
                                    ? "connecting…"
                                    : "off"}
                        </span>
                    </div>
                    {busy === server.name ? <Spinner className="text-faint" /> : null}
                    <Switch
                        checked={server.status !== "off"}
                        disabled={busy !== undefined}
                        aria-label={server.name}
                        onCheckedChange={(enabled) => {
                            void change(server.name, enabled);
                        }}
                    />
                </div>
            ))}
            {error === undefined ? null : <p className="text-meta text-danger">{error}</p>}
        </div>
    );
}

export default {
    settings: [{ id: "servers", title: "MCP servers", component: Servers }],
} satisfies WebExtension;
