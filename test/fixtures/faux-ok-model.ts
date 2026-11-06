// A test-only extension: a faux model that answers "ok" at once, for as many runs as a test needs.
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import type { Host } from "../../server/sdk.ts";

export default function fauxOkModel(host: Host): void {
    const faux = fauxProvider({
        provider: "fx",
        models: [{ id: "m1", contextWindow: 200_000 }],
    });

    faux.setResponses(Array.from({ length: 60 }, () => fauxAssistantMessage("ok")));
    host.registerModelProvider(faux.provider);
}
