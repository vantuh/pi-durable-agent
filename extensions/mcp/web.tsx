import { Plug } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Hint } from "@/components/ui/tooltip.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { type McpState, type ServerInfo, state, toggle } from "./refs.ts";

const REFRESH_MS = 5000;

/** A server may still be connecting when the page opens, so the state is read again on a timer. */
function useMcp() {
    const [current, setCurrent] = useState<McpState | undefined>();

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const update = async (): Promise<void> => {
            try {
                const found = await callAction(state, undefined, null);

                if (alive) {
                    setCurrent(found);
                }
            } catch {
                // The next tick tries again; the last known state stays on screen.
            }

            if (alive) {
                timer = setTimeout(() => {
                    void update();
                }, REFRESH_MS);
            }
        };

        void update();

        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, []);

    return [current, setCurrent] as const;
}

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
        <PopoverContent side="top" aria-label="MCP servers" className="text-meta w-72 p-1">
            {problem === undefined ? null : <p className="text-danger px-2 py-1.5">{problem}</p>}
            {servers.length === 0 && problem === undefined ? (
                <p className="text-faint px-2 py-1.5">No servers in mcp.json.</p>
            ) : null}
            {/* Three rows of h-11 show; more scroll. */}
            <ScrollArea viewportProps={{ className: "max-h-33" }}>
                {servers.map((server) => (
                    <div
                        key={server.name}
                        className="hover:bg-raised rounded-control flex h-11 items-center gap-2 px-2"
                    >
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="text-ink truncate">{server.name}</span>
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
                        </div>
                        {busy === server.name ? <Spinner className="text-faint" /> : null}
                        <Switch
                            checked={server.status !== "off"}
                            disabled={busy !== undefined}
                            aria-label={server.name}
                            onCheckedChange={(on) => {
                                onToggle(server.name, on);
                            }}
                        />
                    </div>
                ))}
            </ScrollArea>
        </PopoverContent>
    );
}

function McpStatus() {
    const [current, setCurrent] = useMcp();
    const [busy, setBusy] = useState<string | undefined>();
    const [failure, setFailure] = useState<string | undefined>();
    const [open, setOpen] = useState(false);

    if (current === undefined) {
        return null;
    }

    const change = async (name: string, on: boolean): Promise<void> => {
        setBusy(name);
        setFailure(undefined);

        try {
            setCurrent(await callAction(toggle, { name, enabled: on }, null));
        } catch (error) {
            setFailure(error instanceof Error ? error.message : "Something went wrong.");
        } finally {
            setBusy(undefined);
        }
    };

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
                problem={failure ?? current.problem}
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
