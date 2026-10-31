// A test-only extension: a faux model that thinks, calls a tool, then thinks again and streams a long
// answer, so a test can watch the live frames of a run that rewrites its answer and then grows it.
import {
    fauxAssistantMessage,
    fauxProvider,
    fauxThinking,
    fauxToolCall,
} from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

const LINES = 1000;
/** One numbered line per row, so a lost tail or a repeated head shows as a different text. */
export const ANSWER = Array.from(
    { length: LINES },
    (_, at) =>
        `line ${String(at).padStart(4, "0")} of the streamed answer, long enough to count.\n`,
).join("");
export const THINKING = "I look at the files first. ".repeat(40);

export default function fauxStreamingModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 200_000 }],
        tokensPerSecond: 4000,
        tokenSize: { min: 20, max: 30 },
    });

    faux.setResponses([
        fauxAssistantMessage([fauxThinking(THINKING), fauxToolCall("bash", { command: "true" })], {
            stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxThinking(THINKING), { type: "text", text: ANSWER }]),
    ]);
    host.registerModelProvider(faux.provider);
}
