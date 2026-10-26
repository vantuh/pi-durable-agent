/**
 * Output speed in the status bar. It needs no hook: every committed answer already carries its output
 * tokens and `durationMs`, the monotonic time from the request's start to its last token.
 */

import { defineExtension } from "@earendil-works/pi-durable";

import type { Host, StatusProvider } from "../../server/extensions.ts";

/**
 * `durationMs` includes the wait for the first token, which cannot be separated from it here. A short
 * or instant answer would show that wait, not a speed, so it shows nothing.
 */
const MIN_WINDOW_MS = 250;
const MIN_OUTPUT_TOKENS = 20;

export const meta = {
    title: "Tokens per second",
    description: "Shows the output speed of the last answer.",
};

export default function tokensPerSecond(host: Host) {
    return defineExtension({ name: host.name });
}

export const status: StatusProvider = ({ entries }) => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const message =
            entries[index]?.kind === "pi.assistant" ? entries[index]?.model?.[0] : undefined;

        if (message?.role !== "assistant") {
            continue;
        }

        const { durationMs } = message;
        const { output } = message.usage;

        if (durationMs === undefined || durationMs < MIN_WINDOW_MS || output < MIN_OUTPUT_TOKENS) {
            return undefined;
        }

        const rate = output / (durationMs / 1000);

        return {
            text: `${rate < 9.95 ? rate.toFixed(1) : String(Math.round(rate))} tok/s`,
            title: `${rate.toFixed(1)} output tokens a second over the last answer, the wait for its first token included`,
        };
    }

    return undefined;
};
