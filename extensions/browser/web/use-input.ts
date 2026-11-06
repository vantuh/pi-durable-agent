import { useRef } from "react";

import { callAction } from "@/sdk/actions.ts";

import { messageOf } from "../../../shared/guards.ts";
import { input } from "../refs.ts";

/** What the person does on the page, sent in order, a few at a time. */
export function useInput(id: number | null, onError: (message: string) => void) {
    const queue = useRef<unknown[]>([]);
    const flushing = useRef(false);

    const flush = async (): Promise<void> => {
        if (flushing.current || id === null) {
            return;
        }

        flushing.current = true;

        try {
            while (queue.current.length > 0) {
                const events = queue.current.splice(0, 50);

                await callAction(input, { events }, id).catch((failure: unknown) => {
                    onError(messageOf(failure));

                    return true;
                });
            }
        } finally {
            flushing.current = false;
        }
    };

    return (event: unknown): void => {
        queue.current.push(event);
        void flush();
    };
}
