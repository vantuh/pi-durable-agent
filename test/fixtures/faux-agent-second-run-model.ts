// A test-only extension: a faux model whose session spawns an agent on "spawn <Name>" and gives it a
// second task on "send <Name>", while the agent's own answer takes a moment, so a test can watch one
// agent's conversation run twice, the second time through no POST of its own.
import {
    fauxAssistantMessage,
    fauxProvider,
    fauxToolCall,
    type TranscriptContext,
} from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

/** Long enough for the list's 100 ms debounce to send the agent's working mark. */
const AGENT_MS = 600;

function lastText(request: TranscriptContext): string {
    const last = request.messages.at(-1);

    if (last?.role !== "user") {
        return "";
    }

    return typeof last.content === "string"
        ? last.content
        : last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export default function fauxAgentSecondRunModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 4000 }],
    });
    const step = async (request: TranscriptContext) => {
        const agent = JSON.stringify(
            request.messages.filter((message) => message.role === "system"),
        ).includes("## Agent protocol");

        if (agent) {
            await new Promise((done) => setTimeout(done, AGENT_MS));

            return fauxAssistantMessage("Agent answer.");
        }

        const said = lastText(request);

        if (said.startsWith("send ")) {
            return fauxAssistantMessage(
                fauxToolCall("agent_send", { name: said.slice(5), message: "Count them again." }),
                { stopReason: "toolUse" },
            );
        }

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
