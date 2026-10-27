import { PROVIDERS, type ProviderUsage } from "./refs.ts";

/** The usage endpoints rate-limit hard, and Anthropic's answers 429 to a few requests a minute. */
const BACKOFF_MS = 5 * 60_000;

type Collect = (skip: readonly string[]) => Promise<ProviderUsage[]>;

/**
 * Remembers each provider's last good reading. A provider that fails keeps showing it, with the
 * reason; one that answered 429 is left alone for a while instead of being asked again.
 */
export function createKeeper(now: () => number = Date.now) {
    const good = new Map<string, ProviderUsage>();
    const failure = new Map<string, string>();
    const until = new Map<string, number>();

    return async (hidden: readonly string[], collect: Collect): Promise<ProviderUsage[]> => {
        const backedOff = PROVIDERS.filter((each) => (until.get(each.id) ?? 0) > now()).map(
            (each) => each.id,
        );
        const fresh = await collect([...hidden, ...backedOff]);

        for (const reading of fresh) {
            if (reading.error === undefined) {
                good.set(reading.id, reading);
                failure.delete(reading.id);
            } else {
                failure.set(reading.id, reading.error);

                if (reading.error === "HTTP 429") {
                    until.set(reading.id, now() + BACKOFF_MS);
                }
            }
        }

        const out: ProviderUsage[] = [];

        for (const { id, name } of PROVIDERS) {
            if (hidden.includes(id)) {
                continue;
            }

            const reading = fresh.find((each) => each.id === id);
            const last = good.get(id);
            const error = failure.get(id);

            if (reading !== undefined && reading.error === undefined) {
                out.push(reading);
            } else if (reading !== undefined || backedOff.includes(id)) {
                const reason =
                    error === "HTTP 429" ? "Rate limited (HTTP 429)" : (error ?? "Unavailable");

                out.push(
                    last === undefined
                        ? { id, name, buckets: [], error: reason }
                        : { ...last, error: `${reason}, showing the last reading` },
                );
            }
        }

        return out;
    };
}
