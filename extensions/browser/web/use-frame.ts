import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { type Frame, frame } from "../refs.ts";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The newest screencast frame, by long-polling: each answer comes when a newer frame exists. */
export function useFrame(id: number | null, open: boolean): (Frame & { src: string }) | undefined {
    const [latest, setLatest] = useState<(Frame & { src: string }) | undefined>(undefined);

    useEffect(() => {
        if (id === null || !open) {
            return undefined;
        }

        const stop = new AbortController();
        const alive = () => !stop.signal.aborted;

        void (async () => {
            let after = 0;

            while (alive()) {
                const started = Date.now();

                try {
                    const next = await callAction(frame, { after }, id);

                    if (next !== null && alive()) {
                        after = next.seq;
                        setLatest({ ...next, src: `data:image/jpeg;base64,${next.image}` });
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
        };
    }, [id, open]);

    return latest;
}
