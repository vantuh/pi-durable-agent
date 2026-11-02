/**
 * A hard timeout on every bash call: pi's terminal environment kills the whole process group when the
 * time runs out and hands the model what the command printed until then, so a stuck command cannot
 * hold a conversation forever. A command that asks for less keeps its own timeout. When the limit is
 * what killed the command, every open browser hears about it: the red row is only visible in the
 * session it ran in, which may be a subagent's conversation nobody is looking at.
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
    AgentDoc,
    defineExtension,
    hook,
    ToolTask,
    type ToolExecutionResult,
} from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host, writeJsonFile } from "../../server/sdk.ts";
import { DEFAULT_MINUTES, FILE, isMinutes, MAX_MINUTES, MIN_MINUTES } from "./refs.ts";

export const meta = {
    title: "Bash timeout",
    description: "Holds every bash command to a limit of minutes, whatever the model asked for.",
};

/**
 * The decision about one call's timeout, in seconds, with null for "the model's own stays". The memo
 * belongs to the call's task, and a task is one call, so `beforeTool` and `afterTool` read the same
 * answer: a resumed attempt cannot run on one timeout and be reported as another.
 */
const LIMIT_MEMO = "bash-timeout:limit";

/** How much of the command the notice shows before it is cut short. */
const COMMAND_CHARS = 60;

/** What pi's bash tool says when the environment kills the command at its timeout. */
const TIMED_OUT = "Command timed out after ";

/** Read on every call, so a save is in force at once; missing or broken means the default. */
async function minutesOf(dataDir: string): Promise<number> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dataDir, FILE), "utf8"));
        const minutes: unknown =
            typeof parsed === "object" && parsed !== null
                ? Reflect.get(parsed, "minutes")
                : undefined;

        return isMinutes(minutes) ? minutes : DEFAULT_MINUTES;
    } catch {
        return DEFAULT_MINUTES;
    }
}

/** The limit in seconds when the call has to run on it, null when the timeout the model asked for is short enough. */
function decisionFor(limit: number, asked: unknown): number | null {
    const own = typeof asked === "number" && asked > 0 && asked <= limit;

    return own ? null : limit;
}

/** Whether the result is the harness reporting the command it killed at its timeout. */
function isTimeout(result: ToolExecutionResult): boolean {
    return (
        result.isError === true &&
        (result.diagnostics ?? []).some(
            (diagnostic) =>
                diagnostic.code === "tool_error" && diagnostic.message.startsWith(TIMED_OUT),
        )
    );
}

/**
 * `Bash timed out after 1 min · sleep 91; echo done · pi-durable-agent`: the line under the session's title.
 * The command is one line and cut short; the folder is left out while the session's is not known.
 */
function timeoutNotice(command: unknown, seconds: number, cwd: string | null | undefined): string {
    const text = typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
    const cut = text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 1)}…` : text;
    const folder =
        cwd === undefined || cwd === null || cwd === "" ? undefined : basename(cwd) || cwd;
    const parts = [
        `Bash timed out after ${String(Math.round(seconds / 60))} min`,
        cut,
        folder,
    ].filter((part): part is string => part !== undefined && part !== "");

    return parts.join(" · ");
}

export default function bashTimeout(host: Host) {
    return defineExtension({
        name: host.name,
        hooks: [
            hook(ToolTask, {
                beforeTool: async (call, api, context) => {
                    if (call.name !== "bash") {
                        return undefined;
                    }

                    const limit = decisionFor(
                        (await minutesOf(host.dataDir)) * 60,
                        call.arguments["timeout"],
                    );
                    // Read, never recomputed: the answer the call was admitted with is the one it keeps, so a
                    // setting saved mid-call cannot make the timeout it runs with and the notice disagree.
                    let applied: number | null;

                    try {
                        applied = await api.memo(LIMIT_MEMO, limit, context);
                    } catch (error) {
                        // The call still runs on the limit; only the notice that it hit ours is lost.
                        host.log(`bash-timeout: could not record the limit: ${String(error)}`);
                        applied = limit;
                    }

                    return applied === null
                        ? undefined
                        : { arguments: { ...call.arguments, timeout: applied } };
                },
                afterTool: async (call, result, api, context) => {
                    if (call.name !== "bash") {
                        return undefined;
                    }

                    try {
                        const applied = await api.memo<number | null>(LIMIT_MEMO, context);

                        if (applied === null || applied === undefined || !isTimeout(result)) {
                            return undefined;
                        }

                        const session = Number(api.conversationId);
                        const agent = await api.snapshot(AgentDoc, api.conversationId, context);

                        host.notify({
                            level: "error",
                            message: (await host.sessionTitle(session)) ?? "New session",
                            session,
                            description: timeoutNotice(
                                call.arguments["command"],
                                applied,
                                agent?.cwd,
                            ),
                        });
                    } catch (error) {
                        // A notice is worth nothing if it costs the model its result.
                        host.log(`bash-timeout: could not report the timeout: ${String(error)}`);
                    }

                    return undefined;
                },
            }),
        ],
    });
}

export const actions = (host: Host): Record<string, Action> => ({
    async settings() {
        return { minutes: await minutesOf(host.dataDir) };
    },
    async saveSettings({ args }) {
        const minutes: unknown =
            typeof args === "object" && args !== null ? Reflect.get(args, "minutes") : undefined;

        if (!isMinutes(minutes)) {
            throw new ActionError(
                `the bash timeout must be a whole number of minutes, ${String(MIN_MINUTES)} to ${String(MAX_MINUTES)}`,
            );
        }

        await writeJsonFile(join(host.dataDir, FILE), { minutes });

        return { minutes };
    },
});
