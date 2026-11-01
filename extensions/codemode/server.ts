/**
 * Code mode: Pi Durable's `codemode` tool, added next to every other tool. The model writes a
 * script that calls the conversation's tools as `await tools.<name>(args)` in a QuickJS sandbox;
 * only the script's output comes back. The model keeps all its own tools as well.
 */

import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Code mode",
    description: "Lets the model write a script that calls its tools, in a sandbox.",
};

export default function codemode(host: Host) {
    const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 });

    // A script running at close is not failed: it resumes with the next version's sandbox.
    host.onDispose(() => sandbox.close());

    // Every tool is already declared to the model directly; scripts find the rest with searchTools().
    return createCodemodeExtension({ sandbox, inlineBudget: 0, models: false });
}
