/** One question through the providers in order: the first that answers wins. */

import type { Found } from "./wire.ts";

/** What one search asks: the angles to cover, folded into the one prompt a provider gets. */
export type Ask = { readonly queries: readonly string[]; readonly urls: readonly string[] };

export type Provider = {
    readonly name: string;
    readonly timeoutMs: number;
    readonly search: (ask: Ask, signal: AbortSignal) => Promise<Found>;
};

export type Outcome =
    | { readonly kind: "answered"; readonly provider: string; readonly found: Found }
    | { readonly kind: "failed"; readonly reasons: readonly string[] }
    | { readonly kind: "aborted" };

export function buildPrompt({ queries, urls }: Ask, listSources: boolean): string {
    const [only] = queries;

    return [
        ...(queries.length === 1 && only !== undefined
            ? [`Search the web and answer this: ${only}`]
            : [
                  "Search the web and answer each of these, covering every angle:",
                  ...queries.map((query) => `- ${query}`),
              ]),
        ...(urls.length === 0
            ? []
            : ["Also read these pages and use them:", ...urls.map((url) => `- ${url}`)]),
        "Be concise and state the facts that matter, with versions and dates where they apply.",
        ...(listSources
            ? [
                  "End with a line `Sources:` and then one URL per line. Write nothing after the list.",
              ]
            : []),
    ].join("\n");
}

/** One short line, so a reason can sit in a list and never carries more than the error's own words. */
function reasonOf(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return (message.split("\n")[0] ?? message).slice(0, 200);
}

export async function runChain(
    providers: readonly Provider[],
    ask: Ask,
    signal: AbortSignal,
): Promise<Outcome> {
    const reasons: string[] = [];

    for (const provider of providers) {
        if (signal.aborted) {
            return { kind: "aborted" };
        }

        const own = AbortSignal.any([signal, AbortSignal.timeout(provider.timeoutMs)]);

        try {
            return {
                kind: "answered",
                provider: provider.name,
                found: await provider.search(ask, own),
            };
        } catch (error) {
            if (signal.aborted) {
                return { kind: "aborted" };
            }

            reasons.push(
                `${provider.name}: ${own.aborted ? `timed out after ${provider.timeoutMs / 1000}s` : reasonOf(error)}`,
            );
        }
    }

    return { kind: "failed", reasons };
}

export function formatAnswer({ found, provider }: Extract<Outcome, { kind: "answered" }>): string {
    const sources = found.sources.slice(0, 20).map((source, index) => {
        const title = source.title.replace(/[[\]]/g, "");

        return `${index + 1}. [${title}](${source.url})`;
    });

    return [
        found.answer,
        ...(sources.length === 0 ? [] : ["## Sources", sources.join("\n")]),
        `Searched with ${provider} (${found.model})`,
    ].join("\n\n");
}
