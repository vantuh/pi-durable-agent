/**
 * How much of the input came from the provider's cache, over the answers still in the context:
 * cache reads over everything the requests sent (fresh input, cache reads, cache writes).
 */

import { defineExtension } from "@earendil-works/pi-durable";

import type { Host, StatusProvider } from "../../server/extensions.ts";

export default function cacheHit(host: Host) {
    return defineExtension({ name: host.name });
}

export const status: StatusProvider = ({ entries }) => {
    let prompt = 0;
    let cached = 0;

    for (const entry of entries) {
        const message = entry.kind === "pi.assistant" ? entry.model?.[0] : undefined;

        if (message?.role === "assistant") {
            prompt += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
            cached += message.usage.cacheRead;
        }
    }

    if (prompt <= 0) {
        return undefined;
    }

    const percent = Math.round((cached / prompt) * 100);

    return {
        slot: "start",
        label: "cache",
        text: `${String(percent)}%`,
        title: `${String(percent)}% of the input came from the cache`,
    };
};
