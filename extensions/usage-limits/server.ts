/**
 * Provider usage limits for the status bar and its popover. Tokens stay on the server: the browser
 * only receives percentages and reset times.
 */
import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/extensions.ts";
import { ActionError } from "../../server/extensions.ts";
import { createKeeper } from "./keeper.ts";
import { collect } from "./readers.ts";
import { PROVIDERS, type UsageResult } from "./refs.ts";
import { readSettings, writeSettings } from "./settings.ts";

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
    // Changes to the file run one after another, so two quick toggles cannot lose one.
    let queue: Promise<unknown> = Promise.resolve();

    const keep = createKeeper();
    const load = (): Promise<UsageResult> => {
        // One lookup serves every caller that arrives while it runs.
        inflight ??= readSettings(host.dataDir)
            .then(({ hidden }) =>
                keep(hidden, (skip) =>
                    collect(host.resolveModelAuth, globalThis.fetch, AbortSignal.timeout(30_000), {
                        hidden: skip,
                    }),
                ),
            )
            .then((providers) => (cache = { providers, at: Date.now() }))
            .finally(() => {
                inflight = undefined;
            });

        return inflight;
    };

    return {
        settings: () => readSettings(host.dataDir),
        setShown: ({ args }) => {
            if (
                typeof args !== "object" ||
                args === null ||
                !("id" in args) ||
                typeof args.id !== "string" ||
                !PROVIDERS.some((each) => each.id === args.id) ||
                !("shown" in args) ||
                typeof args.shown !== "boolean"
            ) {
                throw new ActionError("args must be { id: a provider id, shown: boolean }");
            }

            const { id, shown } = args;
            const change = queue.then(async () => {
                const { hidden } = await readSettings(host.dataDir);
                const next = {
                    hidden: shown
                        ? hidden.filter((each) => each !== id)
                        : [...new Set([...hidden, id])],
                };

                await writeSettings(host.dataDir, next);
                cache = undefined;

                return next;
            });

            queue = change.catch(() => undefined);

            return change;
        },
        providers: async ({ args }) => {
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
                : await load();
        },
    };
};
