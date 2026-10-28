/**
 * Subagents, after Pi Durable's example 23: each agent is its own conversation, owned by a background
 * anchor task, so the parent's Stop never reaches it and the parent is not kept busy by it. Every
 * message to an agent is a background reporter task that submits it, waits for the answer, and posts
 * the answer back to the parent as input. Request IDs keep a restart from sending either twice.
 */

import type { Context } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import {
    type AgentChange,
    AssistantEntry,
    type ConversationId,
    configure,
    defineDoc,
    defineExtension,
    defineTask,
    defineTool,
    type EntryId,
    type EntryRecord,
    LiveDoc,
    type NextTaskState,
    section,
    type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";

import type { Host } from "../../server/sdk.ts";
import { type Profile, readProfiles } from "./profiles.ts";

export const meta = {
    title: "Subagents",
    description:
        "agent_spawn, agent_send, agent_stop and agent_status: hand work to agents from ~/.pi/agent/agents.",
};

type AgentRecord = {
    conversationId: ConversationId;
    /** The profile it runs with. */
    agent: string;
    /** The last tool call that sent it work, so a replayed call sends nothing twice. */
    callId: string;
    /** Answers already reported, so a steered message and the run it joined report once. */
    reported: EntryId[];
    /** Set by agent_stop: the aborted run reports nothing, as the parent asked for it. */
    stopped: boolean;
};

/** The agents a conversation started, by name. */
const AgentsDoc = defineDoc({
    kind: "subagents.agents",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { agents: Record<string, AgentRecord> } => ({ agents: {} }),
    checkpointWhen: () => true,
});

/** Owns an agent's conversation and ends at once: a background boundary, nothing more. */
const Anchor = defineTask<null, { phase: "done" }, null>({
    name: "subagents.anchor",
    version: 1,
    initial: () => ({ phase: "done" }),
    phases: {
        done: (_task, runtime, context) =>
            runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                context,
            ),
    },
    abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type ReporterInput = { name: string; conversationId: ConversationId; message: string };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };

function answerText(entry: EntryRecord | undefined): string {
    const message = entry?.model?.[0];

    if (message?.role !== "assistant") {
        return "";
    }

    return message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
        .trim();
}

/** Delivers one message to an agent and its answer, or why there is none, to the parent. */
const Reporter = defineTask<ReporterInput, ReporterState, null>({
    name: "subagents.reporter",
    version: 1,
    initial: () => ({ phase: "deliver" }),
    phases: {
        deliver: async (task, runtime, context) => {
            const { name, conversationId, message } = task.input;
            const child = await runtime.conversation(conversationId, context);
            const settled =
                child === undefined
                    ? undefined
                    : await (
                          await child.submit(
                              {
                                  type: "input",
                                  content: message,
                                  whenBusy: "steer",
                                  requestId: `subagents:${task.id}`,
                              },
                              context,
                          )
                      ).wait(context);

            await runtime.commit(async (tx) => {
                const next = (report?: string): NextTaskState<ReporterState, null> => ({
                    status: "running",
                    checkpoint:
                        report === undefined ? { phase: "report" } : { phase: "report", report },
                });
                const record = (await tx.doc(AgentsDoc, runtime.conversationId)).agents[name];

                if (settled === undefined) {
                    return next(`[agent ${name} failed: its conversation is gone]`);
                }

                if (settled.status === "unanswered") {
                    return record?.stopped === true
                        ? next()
                        : next(`[agent ${name} failed: ${settled.reason}]`);
                }

                if (
                    settled.type !== "input" ||
                    record === undefined ||
                    record.reported.includes(settled.answer)
                ) {
                    return next();
                }

                record.reported.push(settled.answer);
                const answer = answerText(await tx.entry(AssistantEntry, settled.answer));

                return next(
                    `[agent ${name} (${record.agent}) finished]\n\n${answer === "" ? "(no text)" : answer}`,
                );
            }, context);
        },
        report: async (task, runtime, context) => {
            const { report } = task.state.checkpoint;

            if (report !== undefined) {
                const parent = await runtime.conversation(runtime.conversationId, context);

                await parent?.submit(
                    {
                        type: "input",
                        content: report,
                        whenBusy: "steer",
                        requestId: `subagents-report:${task.id}`,
                    },
                    context,
                );
            }

            await runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                context,
            );
        },
    },
    abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const NO_WAIT =
    "Its outcome arrives as a message automatically. Do not check its status or sleep to wait for it; end your turn or continue unrelated work.";

const GUIDE = `## Agents
You are the Orchestrator. Delegate with agent_spawn, picking the smallest suitable profile from the list below.

Agents do not see this conversation. Each task must be self-contained: goal, scope, paths or links, constraints, expected output, read-only vs edit permission, and, for edits, the check to run.

Run parallel agent_spawn calls only for independent work: separate reads or disjoint write slices, at most 4, each with a distinct name.

Every call returns once the task is submitted. The result arrives as a message that starts with "[agent", even in the middle of your turn. Never wait for it: no status checks to see if it finished, no sleep. Do not redo delegated work yourself; end the turn or continue unrelated work.

A result is a report: verify claims you act on, and synthesize it for the user instead of pasting it. A blocked result or a question needs your decision: answer it with agent_send, or handle the work yourself.

agent_send reaches an existing agent by name: it steers a working agent at its next step, or gives an idle one a new message that keeps its context. Steer only when a correction must reach work already in progress, never to check progress. Stop a run with agent_stop only when the user or a decision requires it; the agent keeps its context. Check an agent with agent_status only when the user asks or a decision you must make now depends on its progress.`;

const PROTOCOL = `## Agent protocol
You are an agent another agent (the Orchestrator) started for one task. It does not see your work, only your final answer, which is delivered to it as a report. Give the complete answer as text, and keep progress narration short.

If the task is ambiguous, or a decision would materially change its scope, end your turn with the question instead of guessing; the Orchestrator answers with a message. Do not ask about what you can settle by reading the project.

End with one line: AGENT_RESULT: done | blocked — <one-line summary>`;

function reply(text: string, isError = false) {
    return { output: [{ type: "text" as const, text }], ...(isError ? { isError } : {}) };
}

function titleCase(name: string): string {
    return name.replace(
        /(^|[-_\s])(\w)/g,
        (_match, gap: string, letter: string) => `${gap === "" ? "" : " "}${letter.toUpperCase()}`,
    );
}

async function busy(api: ToolExecutionApi, id: ConversationId, context: Context): Promise<boolean> {
    return (await api.snapshot(LiveDoc, id, context))?.run !== undefined;
}

/** The model, thinking, tools and instructions of a profile, over the parent's agent the child copies. */
async function childAgent(
    api: ToolExecutionApi,
    profile: Profile,
    context: Context,
): Promise<{ change: AgentChange; warnings: string[] }> {
    const parent = await api.agent(context);
    const warnings: string[] = [];
    const [provider = "", modelId = ""] = profile.model?.split(/\/(.*)/s) ?? [];
    const model =
        profile.model === undefined
            ? undefined
            : (await api.models.getAvailable(provider)).find((each) => each.id === modelId);

    if (profile.model !== undefined && model === undefined) {
        warnings.push(
            `model ${profile.model} is not available here; it runs on this conversation's model`,
        );
    }

    const level = LEVELS.find((each) => each === profile.thinking);
    const known =
        model ?? (parent.model && api.models.getModel(parent.model.provider, parent.model.modelId));
    const thinkingLevel: ModelThinkingLevel | undefined =
        level === undefined || known === undefined ? level : clampThinkingLevel(known, level);
    const wanted = new Set(profile.tools);
    const tools = parent.tools.filter((tool) => wanted.has(tool.name));

    return {
        change: {
            instructions: `${profile.instructions}\n\n${PROTOCOL}`.trim(),
            ...(model === undefined
                ? {}
                : { model: { provider: model.provider, modelId: model.id } }),
            ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
            ...(profile.tools === undefined ? {} : { tools }),
        },
        warnings,
    };
}

export default function subagents(host: Host) {
    // Agents get no agents of their own: the extension is removed from them by name.
    const self = defineExtension({ name: host.name });

    const spawn = defineTool({
        name: "agent_spawn",
        description:
            "Start a new agent with a profile from ~/.pi/agent/agents (or the project's .pi/agents) on a self-contained task. It works in its own conversation; its result arrives as a message.",
        parameters: Type.Object({
            agent: Type.String({
                description: "Profile name, from the Agents section of the prompt.",
            }),
            task: Type.String({ description: "Self-contained task for the new agent." }),
            name: Type.Optional(
                Type.String({
                    description:
                        "Name to address it by later; defaults to the title-cased profile name.",
                }),
            ),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            const task = args.task.trim();
            const parent = await api.agent(context);
            const profiles = await readProfiles(parent.cwd ?? host.cwd);
            const profile = profiles.get(args.agent.trim());

            if (task === "") {
                return reply("task is required.", true);
            }

            if (profile === undefined) {
                return reply(
                    `Unknown agent profile: ${args.agent}. Available: ${[...profiles.keys()].join(", ") || "none"}.`,
                    true,
                );
            }

            const { change, warnings } = await childAgent(api, profile, context);
            const explicit = args.name?.trim() ?? "";
            const base = explicit === "" ? titleCase(profile.name) : explicit;
            const started = await api.commit(async (tx) => {
                const state = await tx.doc(AgentsDoc, api.conversationId);
                const replayed = Object.entries(state.agents).find(
                    ([, record]) => record.callId === api.callId,
                );

                if (replayed !== undefined) {
                    return { name: replayed[0], conversationId: replayed[1].conversationId };
                }

                if (explicit !== "" && state.agents[explicit] !== undefined) {
                    return undefined;
                }

                let name = base;

                for (let n = 2; state.agents[name] !== undefined; n++) {
                    name = `${base} #${n}`;
                }

                const anchor = await tx.createTask(Anchor, null, {
                    ownership: { kind: "conversation" },
                    background: true,
                });
                const child = await tx.createConversation({
                    ownership: { kind: "task", taskId: anchor },
                });

                await configure(tx, child.id, { ...change, extensions: { remove: [self] } });
                state.agents[name] = {
                    conversationId: child.id,
                    agent: profile.name,
                    callId: api.callId,
                    reported: [],
                    stopped: false,
                };
                await tx.createTask(
                    Reporter,
                    { name, conversationId: child.id, message: task },
                    { ownership: { kind: "conversation" }, background: true },
                );

                return { name, conversationId: child.id };
            }, context);

            if (started === undefined) {
                return reply(
                    `An agent named "${explicit}" already exists. Use agent_send with that name to steer or continue it, or pass a different name for a fresh agent.`,
                    true,
                );
            }

            await host.setSessionTitle(
                started.conversationId,
                `${started.name}: ${task.replace(/\s+/g, " ").slice(0, 60)}`,
            );

            return reply(
                [
                    `Agent ${started.name} (${profile.name}) started. ${NO_WAIT}`,
                    ...warnings.map((warning) => `Warning: ${warning}.`),
                ].join("\n"),
            );
        },
    });

    const send = defineTool({
        name: "agent_send",
        description:
            "Send a message to an agent this conversation started, by name: it steers a working agent at its next step, or gives an idle one a new task that keeps its earlier context. Answers a question the agent ended with.",
        parameters: Type.Object({
            name: Type.String({ description: "Exact name of the agent." }),
            message: Type.String({ description: "What to send." }),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            const name = args.name.trim();
            const message = args.message.trim();

            if (message === "") {
                return reply("message is required.", true);
            }

            const record = await api.commit(async (tx) => {
                const found = (await tx.doc(AgentsDoc, api.conversationId)).agents[name];

                if (found !== undefined && found.callId !== api.callId) {
                    found.callId = api.callId;
                    found.stopped = false;
                    await tx.createTask(
                        Reporter,
                        { name, conversationId: found.conversationId, message },
                        { ownership: { kind: "conversation" }, background: true },
                    );
                }

                return found === undefined ? undefined : { ...found };
            }, context);

            if (record === undefined) {
                return reply(
                    `No agent named "${name}" in this conversation. Use agent_spawn to start one.`,
                    true,
                );
            }

            return reply(
                (await busy(api, record.conversationId, context))
                    ? `Message queued for agent ${name}: it joins its current run at the next step. Its answer arrives with its result; do not send it again as a task.`
                    : `Message sent to agent ${name}; it continues with its earlier context. ${NO_WAIT}`,
            );
        },
    });

    const stop = defineTool({
        name: "agent_stop",
        description:
            "Stop the current run of an agent this conversation started. The agent keeps its context; continue it later with agent_send.",
        parameters: Type.Object({ name: Type.String({ description: "Exact name of the agent." }) }),
        replay: "safe",
        execute: async (args, api, context) => {
            const name = args.name.trim();
            const record = await api.commit(async (tx) => {
                const found = (await tx.doc(AgentsDoc, api.conversationId)).agents[name];

                if (found !== undefined) {
                    found.stopped = true;
                }

                return found === undefined ? undefined : { ...found };
            }, context);

            if (record === undefined) {
                return reply(`No agent named "${name}" in this conversation.`, true);
            }

            const working = await busy(api, record.conversationId, context);

            await (await api.conversation(record.conversationId, context))?.abort(context);

            return reply(
                working
                    ? `Agent ${name} stopped; no result comes from that run. It keeps its context: continue it with agent_send.`
                    : `Agent ${name} was not running; nothing to stop.`,
            );
        },
    });

    const status = defineTool({
        name: "agent_status",
        description:
            "Check one agent by name (working or idle, and a preview of its latest text), or list the agents this conversation started. Read-only.",
        parameters: Type.Object({
            name: Type.Optional(
                Type.String({ description: "Exact name of one agent; omit to list them all." }),
            ),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            const agents =
                (await api.snapshot(AgentsDoc, api.conversationId, context))?.agents ?? {};
            const name = args.name?.trim() ?? "";

            if (name === "") {
                const lines = await Promise.all(
                    Object.entries(agents).map(
                        async ([each, record]) =>
                            `${each} (${record.agent}): ${(await busy(api, record.conversationId, context)) ? "working" : "idle"}`,
                    ),
                );

                return reply(
                    lines.length === 0 ? "No agents in this conversation." : lines.join("\n"),
                );
            }

            const record = agents[name];

            if (record === undefined) {
                return reply(`No agent named "${name}" in this conversation.`, true);
            }

            const working = await busy(api, record.conversationId, context);
            const latest = await api.commit(async (tx) => {
                const page = await tx.scanEntries(
                    { conversationId: record.conversationId, order: "descending" },
                    20,
                );

                return page.items.map(answerText).find((text) => text !== "") ?? "";
            }, context);
            const preview = latest.length > 2000 ? `… ${latest.slice(-2000)}` : latest;

            return reply(
                [
                    `Agent ${name} (${record.agent}): ${working ? "working" : "idle"}.`,
                    ...(working ? [NO_WAIT] : []),
                    ...(preview === ""
                        ? []
                        : ["", "Latest text (preview, not a result):", preview]),
                ].join("\n"),
            );
        },
    });

    return defineExtension({
        name: host.name,
        tasks: [Anchor, Reporter],
        tools: [spawn, send, stop, status],
        sections: [
            section("agents", async (input) => {
                const profiles = await readProfiles(input.agent.cwd ?? host.cwd);
                const list = [...profiles.values()]
                    .map((profile) => `- ${profile.name}: ${profile.description}`)
                    .join("\n");

                return `${GUIDE}\n\nProfiles:\n${list || "- none: add one to ~/.pi/agent/agents"}`;
            }),
        ],
    });
}
