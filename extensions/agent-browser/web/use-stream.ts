import { useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { isRecord } from "../../../shared/guards.ts";
import { stream } from "../refs.ts";
import { messagesOf, type PageInput } from "./input.ts";

export type Shot = { src: string; width: number; height: number };

export type StreamState = {
    shot: Shot | undefined;
    url: string;
    title: string;
    /** Whether the daemon has a Chrome: before the first open it has none. */
    connected: boolean;
    error: string | null;
};

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Whether this tab is in front: a hidden one holds no stream open, so agent-browser stops its screencast. */
function useVisible(): boolean {
    const [visible, setVisible] = useState(document.visibilityState === "visible");

    useEffect(() => {
        const update = (): void => {
            setVisible(document.visibilityState === "visible");
        };

        document.addEventListener("visibilitychange", update);

        return () => {
            document.removeEventListener("visibilitychange", update);
        };
    }, []);

    return visible;
}

/**
 * The session's page over agent-browser's WebSocket stream: frames, address and status in, input out. Ack pacing:
 * the next frame comes once this one is drawn, so a slow tab gets the newest page, not a backlog.
 */
export function useStream(id: number | null) {
    const [state, setState] = useState<StreamState>({
        shot: undefined,
        url: "",
        title: "",
        connected: false,
        error: null,
    });
    const socket = useRef<WebSocket | null>(null);
    const visible = useVisible();

    useEffect(() => {
        if (id === null || !visible) {
            return undefined;
        }

        let stopped = false;
        const alive = () => !stopped;
        const set = (change: Partial<StreamState>): void => {
            if (alive()) {
                setState((current) => ({ ...current, ...change }));
            }
        };

        void (async () => {
            while (alive()) {
                const status = await callAction(stream, undefined, id).catch((error: unknown) => {
                    set({ error: error instanceof Error ? error.message : String(error) });

                    return undefined;
                });

                if (status?.port === null || status === undefined) {
                    await sleep(2000);
                    continue;
                }

                set({ connected: status.connected, error: null });
                // agent-browser takes only pages from localhost: the stream does not reach a phone.
                const ws = new WebSocket(`ws://127.0.0.1:${status.port}/?pacing=ack&maxFps=25`);

                socket.current = ws;
                ws.onmessage = (event) => {
                    void receive(ws, event.data);
                };
                await new Promise<void>((closed) => {
                    ws.onclose = () => {
                        closed();
                    };
                });
                socket.current = null;

                if (alive()) {
                    await sleep(1000);
                }
            }
        })();

        const receive = async (ws: WebSocket, data: unknown): Promise<void> => {
            const message: unknown = typeof data === "string" ? JSON.parse(data) : undefined;

            if (!isRecord(message)) {
                return;
            }

            if (message["type"] === "frame" && typeof message["data"] === "string") {
                const meta = isRecord(message["metadata"]) ? message["metadata"] : {};
                const image = new Image();

                image.src = `data:image/jpeg;base64,${message["data"]}`;
                // Decoded before it shows, so frames swap without a flash.
                await image.decode().catch(() => {});
                set({
                    connected: true,
                    shot: {
                        src: image.src,
                        width: Number(meta["deviceWidth"]) || image.naturalWidth,
                        height: Number(meta["deviceHeight"]) || image.naturalHeight,
                    },
                });

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "ack", seq: message["seq"] }));
                }
            } else if (message["type"] === "status") {
                set({ connected: message["connected"] === true });
            } else if (message["type"] === "url" && typeof message["url"] === "string") {
                set({ url: message["url"] });
            } else if (message["type"] === "tabs" && Array.isArray(message["tabs"])) {
                const active = message["tabs"].find(
                    (tab: unknown) => isRecord(tab) && tab["active"] === true,
                );

                if (isRecord(active)) {
                    set({ url: textOf(active["url"]), title: textOf(active["title"]) });
                }
            }
        };

        return () => {
            stopped = true;
            socket.current?.close();
        };
    }, [id, visible]);

    const send = (input: PageInput): void => {
        const ws = socket.current;

        if (ws?.readyState === WebSocket.OPEN) {
            for (const message of messagesOf(input)) {
                ws.send(JSON.stringify(message));
            }
        }
    };

    return { ...state, send };
}
