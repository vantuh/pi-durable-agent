import { useEffect, useState } from "react";

import type { Frame } from "../refs.ts";

const ROUTE = "/api/extensions/browser/http/frame";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Whether this tab is in front: a hidden one fetches no frames, so the screencast stops a while after. */
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

/** The newest screencast frame, by long-polling: each answer comes when a newer frame exists. */
export function useFrame(id: number | null, open: boolean): (Frame & { src: string }) | undefined {
    const [latest, setLatest] = useState<(Frame & { src: string }) | undefined>(undefined);
    const visible = useVisible();

    useEffect(() => {
        if (id === null || !open || !visible) {
            return undefined;
        }

        const stop = new AbortController();
        const alive = () => !stop.signal.aborted;
        let shown: string | undefined;

        void (async () => {
            let after = 0;

            while (alive()) {
                const started = Date.now();

                try {
                    const response = await fetch(`${ROUTE}?session=${id}&after=${after}`, {
                        signal: stop.signal,
                        cache: "no-store",
                    });

                    if (response.status === 200) {
                        const src = URL.createObjectURL(await response.blob());
                        const image = new Image();

                        image.src = src;
                        // Decoded before it shows, so frames swap without a flash.
                        await image.decode().catch(() => {});

                        if (!alive()) {
                            URL.revokeObjectURL(src);
                            break;
                        }

                        const previous = shown;

                        shown = src;
                        after = Number(response.headers.get("x-seq")) || after;
                        setLatest({
                            seq: after,
                            width: Number(response.headers.get("x-width")) || image.naturalWidth,
                            height: Number(response.headers.get("x-height")) || image.naturalHeight,
                            src,
                        });

                        if (previous !== undefined) {
                            // Later than the render that swaps it out.
                            setTimeout(() => URL.revokeObjectURL(previous), 1000);
                        }
                    } else if (response.status !== 204) {
                        throw new Error(`frame: HTTP ${response.status}`);
                    }
                } catch {
                    await sleep(2000);
                }

                // An answer with nothing in it that came at once must not turn into a busy loop.
                if (Date.now() - started < 500) {
                    await sleep(500);
                }
            }
        })();

        return () => {
            stop.abort();

            const last = shown;

            if (last !== undefined) {
                setTimeout(() => URL.revokeObjectURL(last), 1000);
            }
        };
    }, [id, open, visible]);

    return latest;
}
