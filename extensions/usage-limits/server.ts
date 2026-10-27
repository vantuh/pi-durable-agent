/**
 * Provider usage limits for the status bar and its popover. Tokens stay on the server: the browser
 * only receives percentages and reset times.
 */
import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/extensions.ts";
import { ActionError } from "../../server/extensions.ts";
import { collect } from "./readers.ts";
import type { UsageResult } from "./refs.ts";

const CACHE_MS = 60_000;

export const meta = {
    title: "Usage limits",
    description: "Shows the five-hour limit of the current provider and every provider's limits.",
};

export default function usageLimits(host: Host) {
    return defineExtension({ name: host.name });
}

export const actions = (host: Host): Record<string, Action> => {
    let cache: UsageResult | undefined;
    let inflight: Promise<UsageResult> | undefined;

    const load = (): Promise<UsageResult> => {
        // One lookup serves every caller that arrives while it runs.
        inflight ??= collect(host.resolveModelAuth, globalThis.fetch, AbortSignal.timeout(30_000))
            .then((providers) => (cache = { providers, at: Date.now() }))
            .finally(() => {
                inflight = undefined;
            });

        return inflight;
    };

    return {
        providers: ({ args }) => {
            if (
                args !== undefined &&
                (typeof args !== "object" ||
                    args === null ||
                    ("fresh" in args && typeof args.fresh !== "boolean"))
            ) {
                throw new ActionError("fresh must be a boolean");
            }

            const fresh =
                typeof args === "object" && args !== null && "fresh" in args && args.fresh === true;

            return cache !== undefined && !fresh && Date.now() - cache.at < CACHE_MS
                ? cache
                : load();
        },
    };
};
