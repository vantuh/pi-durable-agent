// A test-only extension: a faux model that answers its first request with one `codemode` call, whose
// script runs `bash`, and its second with the text the call returned, so a test can read what the
// script's nested call produced.
import {
    fauxAssistantMessage,
    type FauxResponseStep,
    fauxProvider,
    fauxToolCall,
} from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

export const SCRIPT = `const run = await tools.bash({ command: "echo $((40 + 2))" });
return "bash said " + run.output.trim() + ", exit " + run.exitCode;`;

export default function fauxCodemodeModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", reasoning: true, contextWindow: 200_000 }],
    });
    const call: FauxResponseStep = () =>
        fauxAssistantMessage(fauxToolCall("codemode", { code: SCRIPT }), {
            stopReason: "toolUse",
        });

    faux.setResponses([call, () => fauxAssistantMessage("done")]);
    host.registerModelProvider(faux.provider);
}
