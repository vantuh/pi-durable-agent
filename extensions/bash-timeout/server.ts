/**
 * Two timers on every bash call, so a stuck command cannot hold a conversation forever. The ceiling is a
 * `beforeTool` hook that caps the call's timeout: pi's terminal environment kills the whole process group
 * when the time runs out and hands the model what the command printed until then. The idle guard is a wrap
 * on the tool itself, keyed to progress rather than to wall clock: no output for `IDLE_SECONDS` kills the
 * command long before the ceiling would, and the model is told why it ended. A command that asks for less
 * than the ceiling keeps its own timeout, and the idle guard still watches it. When either timer is what
 * killed the command, every open browser hears about it: the red row is only visible in the session it ran
 * in, which may be a subagent's conversation nobody is looking at.
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { type Context, withCancel } from "@earendil-works/chord/context";
import {
    AgentDoc,
    defineExtension,
    hook,
    type HookApi,
    ToolTask,
    type ToolExecutionResult,
    type ToolHookCall,
    wrapTool,
    type Wrap,
} from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";

import { type Action, ActionError, type Host, writeJsonFile } from "../../server/sdk.ts";
import {
    DEFAULT_MINUTES,
    FILE,
    IDLE_CODE,
    IDLE_SECONDS,
    isMinutes,
    MAX_MINUTES,
    MIN_MINUTES,
} from "./refs.ts";

export const meta = {
    title: "Bash timeout",
    description:
        "Holds every bash command to a limit of minutes, whatever the model asked for, and kills one that goes silent.",
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

/** What the model reads when the idle guard killed its command: silence plus why, or it retries the same silence. */
function idleMessage(seconds: number): string {
    return `No output for ${String(seconds)}s, so the command was killed. Retry with a command that prints progress, or find out why it is silent.`;
}

/** Whether the result carries the idle guard's verdict. */
function isIdle(result: ToolExecutionResult): boolean {
    return (result.diagnostics ?? []).some((diagnostic) => diagnostic.code === IDLE_CODE);
}

/**
 * The wait the idle guard applied, read back from its own verdict rather than from the constant: a test shortens the
 * wait, and an edit to `IDLE_SECONDS` below a minute must not be reported as a minute.
 */
function idleWait(result: ToolExecutionResult): number {
    const message =
        (result.diagnostics ?? []).find((diagnostic) => diagnostic.code === IDLE_CODE)?.message ??
        "";
    const seconds = /No output for (\d+)s/.exec(message)?.[1];

    return seconds === undefined ? IDLE_SECONDS : Number(seconds);
}

/** `30 s` or `10 min`: a wait under a minute is not rounded to nothing. */
function waitOf(seconds: number): string {
    return seconds < 60 ? `${String(seconds)} s` : `${String(Math.round(seconds / 60))} min`;
}

/**
 * pi's message gives the seconds but not whose clock they were, so the model reads an agent's shared ceiling as if it
 * were a timeout of its own. One sentence says which it was and what to do instead of retrying the same command.
 */
function ceilingResult(result: ToolExecutionResult, seconds: number): ToolExecutionResult {
    return {
        ...result,
        diagnostics: (result.diagnostics ?? []).map((diagnostic) =>
            diagnostic.code === "tool_error" && diagnostic.message.startsWith(TIMED_OUT)
                ? {
                      ...diagnostic,
                      message: `${diagnostic.message} — the agent's shared bash limit (${waitOf(seconds)}), not a timeout you asked for. The command was killed, not finished: the output above is everything it printed. Split it into smaller steps or narrow its scope.`,
                  }
                : diagnostic,
        ),
    };
}

/** Whether an error is the environment reporting the command it killed on abort, rather than a timeout or a throw. */
function isAborted(error: unknown): boolean {
    return typeof error === "object" && error !== null && Reflect.get(error, "code") === "aborted";
}

/**
 * The idle guard: `bash` killed when it prints nothing for `seconds`, and an error result saying so. The wrap only
 * cancels a child of the call's context, so the environment kills the command's process group and the caller's own
 * cancellation still reaches it. Everything else — a normal end, the ceiling's timeout, the caller's abort — is left
 * exactly as the tool returned or threw it.
 */
export function idleGuard(seconds: number): Wrap {
    return wrapTool(createBashTool(), (inner) => ({
        ...inner,
        execute: async (args, api, context) => {
            const child = withCancel(context);
            let killed = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            // Rearmed by every chunk: progress, on either stream, is what says the command is alive.
            const watch = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    killed = true;
                    child.cancel(new Error(`no output for ${String(seconds)}s`));
                }, seconds * 1000);
            };
            const observed: typeof api = {
                ...api,
                output: (chunk, skipped) => {
                    api.output(chunk, skipped);
                    watch();
                },
            };

            watch();

            try {
                return await inner.execute(args, observed, child.context);
            } catch (error) {
                // A timeout is reported ahead of an abort, and the caller's own abort is not ours to report.
                if (!killed || context.abortSignal?.aborted === true || !isAborted(error)) {
                    throw error;
                }

                return {
                    isError: true,
                    diagnostics: [
                        { severity: "error", code: IDLE_CODE, message: idleMessage(seconds) },
                    ],
                };
            } finally {
                clearTimeout(timer);
            }
        },
    }));
}

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
function bashNotice(lead: string, command: unknown, cwd: string | null | undefined): string {
    const text = typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
    const cut = text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 1)}…` : text;
    const folder =
        cwd === undefined || cwd === null || cwd === "" ? undefined : basename(cwd) || cwd;
    const parts = [lead, cut, folder].filter(
        (part): part is string => part !== undefined && part !== "",
    );

    return parts.join(" · ");
}

export default function bashTimeout(host: Host) {
    /**
     * Says in every open browser that a bash call ended on `lead`, with the command and the folder under it. The
     * session is the call's own, so a subagent's kill is not invisible. A notice that fails is worth less than the
     * result the model is about to read, so it is logged and dropped.
     */
    async function announce(
        call: ToolHookCall,
        lead: string,
        api: HookApi,
        context: Context,
    ): Promise<void> {
        try {
            const session = Number(api.conversationId);
            const agent = await api.snapshot(AgentDoc, api.conversationId, context);

            host.notify({
                level: "error",
                message: (await host.sessionTitle(session)) ?? "New session",
                session,
                description: bashNotice(lead, call.arguments["command"], agent?.cwd),
            });
        } catch (error) {
            host.log(`bash-timeout: could not report the kill: ${String(error)}`);
        }
    }

    return defineExtension({
        name: host.name,
        wraps: [idleGuard(IDLE_SECONDS)],
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

                    // Ahead of the memo: a call the model gave its own shorter timeout gets no memo, and the idle
                    // guard kills it anyway.
                    if (isIdle(result)) {
                        await announce(
                            call,
                            `Bash idle for ${waitOf(idleWait(result))}`,
                            api,
                            context,
                        );

                        return undefined;
                    }

                    const applied = await api.memo<number | null>(LIMIT_MEMO, context);

                    if (applied === null || applied === undefined || !isTimeout(result)) {
                        return undefined;
                    }

                    await announce(call, `Bash timed out after ${waitOf(applied)}`, api, context);

                    return ceilingResult(result, applied);
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
