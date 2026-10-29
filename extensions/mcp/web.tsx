import { Plug } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { callAction } from "@/sdk/actions.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { type McpState, type ServerInfo, state } from "./refs.ts";

const REFRESH_MS = 5000;

/** A server may still be connecting when the page opens, so the state is read again on a timer. */
function useMcp(): McpState | undefined {
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

    return current;
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
    if (server.status === "connected") {
        return `${String(server.tools)} tools`;
    }

    return server.status === "error" ? (server.error ?? "failed") : "connecting…";
}

function Popover({
    anchor,
    servers,
    problem,
    onClose,
}: {
    anchor: HTMLElement;
    servers: ServerInfo[];
    problem: string | undefined;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    // Above the button, since the status bar is at the bottom; kept inside the window on a phone.
    const [place] = useState(() => {
        const box = anchor.getBoundingClientRect();
        const width = Math.min(288, innerWidth - 16);
        const left = Math.min(
            Math.max(8, box.left + box.width / 2 - width / 2),
            innerWidth - width - 8,
        );

        return { bottom: innerHeight - box.top + 8, left };
    });

    useEffect(() => {
        const away = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !ref.current?.contains(event.target) &&
                !anchor.contains(event.target)
            ) {
                onClose();
            }
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("pointerdown", away);
        document.addEventListener("keydown", escape);

        return () => {
            document.removeEventListener("pointerdown", away);
            document.removeEventListener("keydown", escape);
        };
    }, [anchor, onClose]);

    return createPortal(
        <dialog
            ref={ref}
            open
            aria-label="MCP servers"
            style={place}
            className="border-edge bg-panel text-meta text-ink fixed top-auto right-auto z-50 m-0 max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border p-3 shadow-lg"
        >
            <div className="text-ink mb-2 font-medium">MCP servers</div>
            {problem === undefined ? null : <p className="text-danger mb-2">{problem}</p>}
            {servers.length === 0 && problem === undefined ? (
                <p className="text-faint">No server is on. Switch them on in Extensions.</p>
            ) : null}
            {servers.map((server) => (
                <div key={server.name} className="mb-2 flex flex-col last:mb-0">
                    <span className="text-ink">{server.name}</span>
                    <span className="text-faint truncate font-mono">{server.target}</span>
                    <span className={server.status === "error" ? "text-danger" : "text-muted"}>
                        {detail(server)}
                    </span>
                </div>
            ))}
        </dialog>,
        document.body,
    );
}

function McpStatus() {
    const current = useMcp();
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const close = useCallback(() => {
        setOpen(false);
    }, []);

    if (current === undefined) {
        return null;
    }

    const on = current.servers.filter((server) => server.status !== "off");
    const connected = on.filter((server) => server.status === "connected").length;
    const title = `MCP: ${String(connected)} of ${String(on.length)} servers connected`;

    return (
        <>
            <button
                ref={setAnchor}
                type="button"
                title={title}
                aria-label={title}
                aria-expanded={open}
                onClick={() => {
                    setOpen((previous) => !previous);
                }}
                className="hover:bg-sunken aria-expanded:bg-sunken flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5"
            >
                <Plug className={`size-3.5 ${toneOf(on)}`} />
                <span className="text-ink">MCP</span>
                <span className="font-mono tabular-nums">
                    {String(connected)}/{String(on.length)}
                </span>
            </button>
            {open && anchor !== null ? (
                <Popover anchor={anchor} servers={on} problem={current.problem} onClose={close} />
            ) : null}
        </>
    );
}

export default {
    status: [{ id: "servers", slot: "end", component: McpStatus }],
} satisfies WebExtension;
