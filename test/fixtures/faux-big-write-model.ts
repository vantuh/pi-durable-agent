// A test-only extension: a faux model whose first response is a `write` call with a large body followed by a long
// streamed answer, so the call stays in every live frame of that response while the answer grows.
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

export const WRITE_PATH = "big.txt";
/** One numbered line per row, so a lost or repeated part shows as a different text. */
export const WRITE_CONTENT = Array.from(
    { length: 350 },
    (_, at) =>
        `row ${String(at).padStart(3, "0")} of the file the model writes, padded to count.\n`,
).join("");
export const WRITE_ANSWER = Array.from(
    { length: 600 },
    (_, at) =>
        `line ${String(at).padStart(4, "0")} of the answer written after the call, to count.\n`,
).join("");

export default function fauxBigWriteModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 200_000 }],
        tokensPerSecond: 4000,
        tokenSize: { min: 20, max: 30 },
    });

    faux.setResponses([
        fauxAssistantMessage(
            [
                fauxToolCall("write", { path: WRITE_PATH, content: WRITE_CONTENT }),
                { type: "text", text: WRITE_ANSWER },
            ],
            { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("written"),
    ]);
    host.registerModelProvider(faux.provider);
}
