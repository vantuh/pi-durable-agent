import { Alert } from "@/components/ui/alert.tsx";
import { Empty } from "@/components/ui/empty.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { ExtensionDetailsProps } from "@/sdk/types.ts";
import { DetailsColumn, DetailsNote } from "@/ui/details.tsx";

import { useMcp } from "./client.ts";

/** The servers from mcp.json, each with a switch. */
export default function Details({ enabled, installed }: ExtensionDetailsProps) {
    const active = enabled && installed;
    const { current, busy, error, change } = useMcp({ active });

    if (!active) {
        return <DetailsNote>Turn the extension on to see its servers.</DetailsNote>;
    }

    if (current === undefined) {
        return error === undefined ? <Spinner className="text-faint" /> : <Alert>{error}</Alert>;
    }

    return (
        <DetailsColumn>
            {current.problem === undefined ? null : (
                <Alert
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `output` is a calculation's result, and a config file's problem is not one
                    role="status"
                >
                    {current.problem}
                </Alert>
            )}
            {current.servers.length === 0 && current.problem === undefined ? (
                <Empty className="text-muted">No servers in mcp.json.</Empty>
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
                        onCheckedChange={(on) => {
                            void change(server.name, on);
                        }}
                    />
                </div>
            ))}
            {error === undefined ? null : <Alert>{error}</Alert>}
        </DetailsColumn>
    );
}
