/**
 * Code mode: Pi Durable's `codemode` tool, added next to every other tool. The model writes a
 * script that calls the conversation's tools as `await tools.<name>(args)` in a QuickJS sandbox;
 * only the script's output comes back. The model keeps all its own tools as well.
 */

import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type { PromptSection } from "@earendil-works/pi-durable";
import { CODEMODE_TOOL_NAME, createCodemodeExtension } from "@earendil-works/pi-durable/codemode";

import type { Host } from "../../server/sdk.ts";

export const meta = {
    title: "Code mode",
    description: "Lets the model write a script that calls its tools, in a sandbox.",
};

/** Tokens of tool declarations the `codemode` section may list: the pi-durable default. */
const INLINE_BUDGET = 3000;

export default function codemode(host: Host) {
    const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 });

    // On a reload the running script finishes on this sandbox first; after a restart it replays on the next one.
    host.onDispose(() => sandbox.close());

    const installed = createCodemodeExtension({
        sandbox,
        inlineBudget: INLINE_BUDGET,
        models: false,
    });

    // Where a script can run: the tool is offered, and the budget leaves something to list. An empty budget would only
    // say "some tools are not listed".
    const guarded = (each: PromptSection): PromptSection => ({
        ...each,
        render: (input, context) =>
            INLINE_BUDGET > 0 && input.agent.tools.some((tool) => tool.name === CODEMODE_TOOL_NAME)
                ? each.render(input, context)
                : undefined,
    });

    return {
        ...installed,
        sections: (installed.sections ?? []).map((each) =>
            each.key === "codemode" ? guarded(each) : each,
        ),
    };
}
