import { Plug } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty } from "@/components/ui/empty.tsx";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Hint } from "@/components/ui/tooltip.tsx";
import type { WebExtension } from "@/sdk/types.ts";

import type { ServerInfo } from "./refs.ts";
import { useMcp } from "./web/client.ts";

const REFRESH_MS = 5000;

function toneOf(servers: ServerInfo[]): string {
    if (servers.some((server) => server.status === "error")) {
        return "text-danger";
    }

    if (servers.some((server) => server.status === "connecting")) {
        return "text-warn";
    }

    return servers.length === 0 ? "text-faint" : "text-ok";
}

function detail(server: ServerInfo): string {
    if (server.status === "off") {
        return "off";
    }

    if (server.status === "connected") {
        return `${String(server.tools)} tools`;
    }

    return server.status === "error" ? (server.error ?? "failed") : "connecting…";
}

function Panel({
    servers,
    problem,
    busy,
    onToggle,
}: {
    servers: ServerInfo[];
    problem: string | undefined;
    busy: string | undefined;
    onToggle: (name: string, on: boolean) => void;
}) {
    return (
        <PopoverContent size="menu" side="top" aria-label="MCP servers" className="text-meta">
            {problem === undefined ? null : (
                <Alert
                    className="px-2 py-1.5"
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- `output` is a calculation's result, and a config file's problem is not one
                    role="status"
                >
                    {problem}
                </Alert>
            )}
            {servers.length === 0 && problem === undefined ? (
                <Empty className="px-2 py-1.5">No servers in mcp.json.</Empty>
            ) : null}
            {/* Three rows of h-11 show; more scroll. */}
            <ScrollArea viewportProps={{ className: "max-h-33" }}>
                {servers.map((server) => (
                    <Item key={server.name} className="hover:bg-raised h-11 py-0">
                        <ItemContent>
                            <ItemTitle className="text-meta">{server.name}</ItemTitle>
                            <span className="truncate">
                                <span
                                    className={
                                        server.status === "error" ? "text-danger" : "text-muted"
                                    }
                                >
                                    {detail(server)}
                                </span>
                                {server.status === "error" ? null : (
                                    <span className="text-faint font-mono"> · {server.target}</span>
                                )}
                            </span>
                        </ItemContent>
                        <ItemActions className="gap-2">
                            {busy === server.name ? <Spinner className="text-faint" /> : null}
                            <Switch
                                checked={server.status !== "off"}
                                disabled={busy !== undefined}
                                aria-label={server.name}
                                onCheckedChange={(on) => {
                                    onToggle(server.name, on);
                                }}
                            />
                        </ItemActions>
                    </Item>
                ))}
            </ScrollArea>
        </PopoverContent>
    );
}

function McpStatus() {
    const { current, busy, error, change } = useMcp({ refreshMs: REFRESH_MS });
    const [open, setOpen] = useState(false);

    if (current === undefined) {
        return null;
    }

    const on = current.servers.filter((server) => server.status !== "off");
    const title = `MCP: ${String(on.length)} of ${String(current.servers.length)} servers on`;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Hint label={title}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={title}
                        className="hover:bg-sunken aria-expanded:bg-sunken shrink-0 px-1.5 py-0.5"
                    >
                        <Plug className={`size-3.5 ${toneOf(on)}`} />
                        <span className="text-ink">MCP</span>
                        <span className="text-muted font-mono tabular-nums">
                            {String(on.length)}/{String(current.servers.length)}
                        </span>
                    </Button>
                </PopoverTrigger>
            </Hint>
            <Panel
                servers={current.servers}
                problem={error ?? current.problem}
                busy={busy}
                onToggle={(name, wanted) => {
                    void change(name, wanted);
                }}
            />
        </Popover>
    );
}

export default {
    status: [{ id: "servers", slot: "end", component: McpStatus }],
} satisfies WebExtension;
