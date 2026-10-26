/**
 * How full the context is, in the middle of the status bar: the last answer's tokens (prompt, cache,
 * and output: what the next request starts from) over the model's context window.
 */

import { defineExtension } from "@earendil-works/pi-durable";

import type { Host, StatusProvider } from "../../server/extensions.ts";

const WARN_ABOVE = 0.7;
const DANGER_ABOVE = 0.9;

function tokens(count: number): string {
    return count >= 1000 ? `${String(Math.round(count / 1000))}k` : String(count);
}

export const meta = {
    title: "Context meter",
    description: "Shows how full the context window is.",
};

export default function contextMeter(host: Host) {
    return defineExtension({ name: host.name });
}

export const status: StatusProvider = ({ entries, contextWindow }) => {
    // A compaction or reset drops what earlier answers measured; with no newer answer there is no number.
    let boundary = -1;

    for (const entry of entries) {
        if (entry.kind === "pi.compaction" || entry.kind === "pi.reset") {
            boundary = Math.max(boundary, Number(entry.id));
        }
    }

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        const message = entry?.kind === "pi.assistant" ? entry.model?.[0] : undefined;

        if (entry === undefined || Number(entry.id) < boundary) {
            return undefined;
        }

        if (
            message?.role !== "assistant" ||
            message.stopReason === "error" ||
            message.stopReason === "aborted"
        ) {
            continue;
        }

        const { input, output, cacheRead, cacheWrite } = message.usage;
        const used = input + output + cacheRead + cacheWrite;
        const window = contextWindow(message.provider, message.model);

        if (used <= 0 || window === undefined || window <= 0) {
            return undefined;
        }

        const fill = Math.min(1, used / window);

        return {
            slot: "center",
            label: "context",
            meter: {
                fill,
                ...(fill > DANGER_ABOVE
                    ? { tone: "danger" }
                    : fill > WARN_ABOVE
                      ? { tone: "warn" }
                      : {}),
            },
            text: `${String(Math.round(fill * 100))}%`,
            title: `${tokens(used)} of ${tokens(window)} tokens in context`,
        };
    }

    return undefined;
};
