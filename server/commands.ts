/**
 * Slash commands: what the composer runs instead of saying something to the agent. A command is not a message, so it
 * never enters the transcript; the effect it has on the conversation shows up on its own, in `pi.live` and the entries
 * the harness writes.
 */

import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Harness } from "@earendil-works/pi-durable";

import type { CommandResult } from "../shared/protocol.ts";

type Run = {
    conversation: Conversation;
    harness: Harness;
    context: Context;
    /** Everything after the command's name, trimmed; `""` when it was typed alone. */
    args: string;
};

const COMMANDS: Record<string, (run: Run) => Promise<CommandResult>> = {
    /**
     * Summarize everything but the newest `keepRecentTokens`, as `/compact` does in Pi: the arguments are the summary's
     * additional focus. The harness summarizes while the conversation keeps working and places the summary at once when
     * idle, otherwise at the next boundary; with nothing old enough to summarize it settles without writing anything.
     */
    compact: async ({ conversation, harness, context, args }) => {
        const task = await conversation.compact(args === "" ? undefined : args, context);
        const { outcome } = (await harness.waitForTask(task, context)).state;

        if (outcome.status !== "completed") {
            throw new Error(outcome.error?.message ?? `the compaction ended ${outcome.status}`);
        }

        const { entryId, submissionId } = outcome.result;

        return entryId === undefined && submissionId === undefined
            ? { status: "empty" }
            : { status: "started" };
    },
};

export async function runCommand(name: string, run: Run): Promise<CommandResult> {
    const command = COMMANDS[name];

    if (command === undefined) {
        throw new Error(`no command named "${name}"`);
    }

    return await command(run);
}
