// A test-only extension: a faux model that spawns an agent on "spawn <Name>" and keeps the agent
// working for a moment, so a test can watch the agent's conversation from the outside.
import {
    fauxAssistantMessage,
    fauxProvider,
    fauxToolCall,
    type TranscriptContext,
} from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

const CHILD_WORKS_MS = 2500;

function lastText(request: TranscriptContext): string {
    const last = request.messages.at(-1);

    if (last?.role !== "user") {
        return "";
    }

    return typeof last.content === "string"
        ? last.content
        : last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export default function fauxAgentModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 4000 }],
    });
    const step = async (request: TranscriptContext) => {
        const child = JSON.stringify(
            request.messages.filter((message) => message.role === "system"),
        ).includes("## Agent protocol");

        if (child) {
            await new Promise((done) => setTimeout(done, CHILD_WORKS_MS));

            return fauxAssistantMessage("Child answer.");
        }

        const said = lastText(request);

        return said.startsWith("spawn ")
            ? fauxAssistantMessage(
                  fauxToolCall("agent_spawn", {
                      agent: "counter",
                      name: said.slice(6),
                      task: "Count the files.",
                  }),
                  { stopReason: "toolUse" },
              )
            : fauxAssistantMessage("ok");
    };

    faux.setResponses(Array.from({ length: 50 }, () => step));
    host.registerModelProvider(faux.provider);
}
