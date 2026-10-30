// A test-only extension: a faux model that calls a tool a few times, slowly, before it answers, so a
// test can watch a run append many entries while the session list has nothing new to show for them.
import {
    fauxAssistantMessage,
    type FauxResponseStep,
    fauxProvider,
    fauxToolCall,
} from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

/** Tool rounds one answer takes, and how long each waits: enough entries to span several list debounces. */
export const ROUNDS = 20;
const ROUND_MS = 50;

export default function fauxToolLoopModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 200_000 }],
    });
    let rounds = 0;
    const step: FauxResponseStep = async () => {
        rounds += 1;

        if (rounds > ROUNDS) {
            return fauxAssistantMessage("done");
        }

        await new Promise((done) => setTimeout(done, ROUND_MS));

        return fauxAssistantMessage(fauxToolCall("bash", { command: "true" }), {
            stopReason: "toolUse",
        });
    };

    // A later message answers at once: the rounds are spent.
    faux.setResponses(Array.from({ length: ROUNDS + 5 }, () => step));
    host.registerModelProvider(faux.provider);
}
