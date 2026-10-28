/**
 * Kiro models as one more provider in the picker, driven over `kiro-cli acp` by the local
 * `pi-kiro-acp` package. Kiro sees the conversation's own tools, never its built-ins, and keeps its
 * own sign-in: nothing here asks for a key.
 */

import { createKiroAcpProvider } from "@vantuh/pi-kiro-acp/provider";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Kiro ACP",
    description: "Adds the local kiro-cli's models, provider kiro-acp, to the model picker.",
};

export default function kiroAcp(host: Host): void {
    const provider = createKiroAcpProvider();

    // The registration goes with this version, so the next reload replaces it; the processes it
    // started need stopping too.
    host.registerModelProvider(provider);
    host.onDispose(() => provider.close());
}
