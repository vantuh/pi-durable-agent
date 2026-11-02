/**
 * Subagents, after Pi Durable's example 23: each agent is its own conversation, owned by a background
 * anchor task, so the parent's Stop never reaches it and the parent is not kept busy by it. Every
 * message to an agent is a background reporter task that submits it, waits for the answer, and posts
 * the answer back to the parent as input. Request IDs keep a restart from sending either twice.
 */

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { Context } from "@earendil-works/chord/context";
import { type AssistantMessage, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
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
    wrapSection,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";

import {
    ActionError,
    type Action,
    type CommitView,
    type Host,
    skillsFor,
} from "../../server/sdk.ts";
import { writeProfileModel } from "./profile-model.ts";
import { type Profile, readProfiles } from "./profiles.ts";
import type { NamedAgent, ProfileRow, Strip, StripAgent } from "./refs.ts";

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
    /** How many times agent_stop ran; a Reporter made before the latest stop must not deliver. */
    stops?: number;
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

/**
 * How an agent's prompt differs from its parent's, from its profile; only agents have one. `rules`
 * false drops the rules section, `skills` lists only those skills (null: every skill).
 */
const ChildDoc = defineDoc({
    kind: "subagents.child",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: (): { rules: boolean; skills: string[] | null } => ({ rules: true, skills: null }),
    checkpointWhen: () => true,
});

/** This extension's tools; an agent keeps the extension for its prompt wraps, not for these. */
const OWN_TOOLS = new Set(["agent_spawn", "agent_send", "agent_stop", "agent_status"]);

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

type ReporterInput = {
    name: string;
    conversationId: ConversationId;
    message: string;
    /** The agent's `stops` when this was made. */
    stops?: number;
};
/** `report` is what the parent's model reads; `text`, what its screen shows under the agent's name. */
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string; text?: string };

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
            const { name, conversationId, message, stops = 0 } = task.input;
            const child = await runtime.conversation(conversationId, context);
            const stoppedSince = async () =>
                ((await runtime.snapshot(AgentsDoc, runtime.conversationId, context))?.agents[name]
                    ?.stops ?? 0) !== stops;
            const submission =
                child === undefined || (await stoppedSince())
                    ? undefined
                    : await child.submit(
                          {
                              type: "input",
                              content: message,
                              entry: {
                                  kind: "subagents.instruction",
                                  data: {
                                      text: message,
                                      author: "Orchestrator",
                                      session: runtime.conversationId,
                                  },
                              },
                              whenBusy: "steer",
                              requestId: `subagents:${task.id}`,
                          },
                          context,
                      );

            // A stop between the check above and the submit has already aborted the child, so this one is withdrawn here.
            if (
                child !== undefined &&
                submission !== undefined &&
                (await stoppedSince()) &&
                (await submission.abort(context)) === "already_placed"
            ) {
                await child.abort(context);
            }

            const settled = await submission?.wait(context);

            await runtime.commit(async (tx) => {
                const next = (
                    report?: string,
                    text?: string,
                ): NextTaskState<ReporterState, null> => ({
                    status: "running",
                    checkpoint:
                        report === undefined || text === undefined
                            ? { phase: "report" }
                            : { phase: "report", report, text },
                });
                const failed = (why: string) =>
                    next(`[agent ${name} failed: ${why}]`, `Failed: ${why}`);
                const record = (await tx.doc(AgentsDoc, runtime.conversationId)).agents[name];

                if ((record?.stops ?? 0) !== stops) {
                    return next();
                }

                if (settled === undefined) {
                    return failed("its conversation is gone");
                }

                if (settled.status === "unanswered") {
                    return record?.stopped === true ? next() : failed(settled.reason);
                }

                if (
                    settled.type !== "input" ||
                    record === undefined ||
                    record.reported.includes(settled.answer)
                ) {
                    return next();
                }

                record.reported.push(settled.answer);
                const answer =
                    answerText(await tx.entry(AssistantEntry, settled.answer)) || "(no text)";

                return next(`[agent ${name} (${record.agent}) finished]\n\n${answer}`, answer);
            }, context);
        },
        report: async (task, runtime, context) => {
            const { report, text } = task.state.checkpoint;
            const { name, conversationId } = task.input;

            if (report !== undefined) {
                const parent = await runtime.conversation(runtime.conversationId, context);

                await parent?.submit(
                    {
                        type: "input",
                        content: report,
                        entry: {
                            kind: "subagents.report",
                            data: { text: text ?? report, author: name, session: conversationId },
                        },
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

const NO_WAIT =
    "Its outcome arrives as a message automatically. Do not check its status or sleep to wait for it; end your turn or continue unrelated work.";

const GUIDE = `## Agents
You are the Orchestrator. Delegate with agent_spawn, picking the smallest suitable profile from the list below.

Agents can only start from existing Markdown profiles. Their model and thinking come only from the profile (omitted thinking means off). Never pass model, thinking, or thinkingLevel overrides to agent_spawn. If a profile is invalid or its model is unavailable, no agent starts: report the tool error, choose another existing profile, or ask the user to fix the profile. Do not invent a replacement model.

Agents do not see this conversation. Each task must be self-contained: goal, scope, paths or links, constraints, expected output, read-only vs edit permission, and, for edits, the check to run.

Run parallel agent_spawn calls only for independent work: separate reads or disjoint write slices, at most 4, each with a distinct name.

An agent's tools run in this conversation's folder unless you pass cwd, an absolute folder: when the work belongs in a worktree you made, pass that worktree's path, and the agent's relative paths, edits, and commands all go there instead.

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

function isDirectory(folder: string): boolean {
    try {
        return statSync(folder).isDirectory();
    } catch {
        return false;
    }
}

/** The model, thinking, tools and instructions of a profile, over the parent's agent the child copies. */
async function childAgent(
    api: ToolExecutionApi,
    profile: Profile,
    context: Context,
): Promise<{ change: AgentChange } | { error: string }> {
    if (profile.model === undefined) {
        return {
            error: `Profile "${profile.name}": model is required in its Markdown frontmatter.`,
        };
    }

    if (profile.invalidTools !== undefined) {
        return {
            error: `Profile "${profile.name}": tools must be a list of names, got ${JSON.stringify(profile.invalidTools)}.`,
        };
    }

    const [provider = "", modelId = ""] = profile.model.split(/\/(.*)/s);

    if (provider === "" || modelId === "") {
        return {
            error: `Profile "${profile.name}": model must be an exact provider/modelId, got "${profile.model}".`,
        };
    }

    const available = await api.models.getAvailable(provider);
    const model = available.find((each) => each.id === modelId);

    if (model === undefined) {
        return {
            error: `Profile "${profile.name}": model "${profile.model}" is not available here. Available for ${provider}: ${available.map((each) => each.id).join(", ") || "none (check provider registration and authentication)"}.`,
        };
    }

    const supported = getSupportedThinkingLevels(model);
    const requested = profile.thinking === undefined ? "off" : profile.thinking;
    const thinkingLevel = supported.find((each) => each === requested);

    if (thinkingLevel === undefined) {
        return {
            error: `Profile "${profile.name}": thinking ${JSON.stringify(requested)} is not supported by ${profile.model}. Supported: ${supported.join(", ")}.`,
        };
    }

    const parent = await api.agent(context);
    const wanted = new Set(profile.tools);
    const own = parent.tools.filter((tool) => OWN_TOOLS.has(tool.name));
    const tools = parent.tools.filter((tool) => wanted.has(tool.name) && !OWN_TOOLS.has(tool.name));

    return {
        change: {
            instructions: `${profile.instructions}\n\n${PROTOCOL}`.trim(),
            model: { provider: model.provider, modelId: model.id },
            thinkingLevel,
            tools: profile.tools === undefined ? { remove: own } : tools,
        },
    };
}

/**
 * What the strip needs of a conversation something else started, as of its latest commit. The
 * parent is the core's owner link; a commit is the only source of the rest. Its name and profile
 * are not here: the parent's `AgentsDoc` keeps them.
 */
type Seen = {
    owner: number;
    cwd: string | null;
    busy: boolean;
    answer: AssistantMessage | undefined;
};

const seen = new Map<number, Seen>();

/** The parent's record of an agent: its name and its profile. */
type Named = { name: string; profile: string };

async function stripAgent(
    host: Host,
    id: number,
    child: Seen,
    named: Named | undefined,
    parentCwd: string,
): Promise<StripAgent> {
    const { answer, cwd } = child;
    const profile = named?.profile ?? "";
    const used =
        answer === undefined
            ? 0
            : answer.usage.input +
              answer.usage.output +
              answer.usage.cacheRead +
              answer.usage.cacheWrite;
    const window =
        answer === undefined ? 0 : (host.contextWindow(answer.provider, answer.model) ?? 0);
    // Before its first answer the profile is the only place that names the model; spawn read it
    // from the parent's folder, whatever folder the agent works in.
    const model =
        answer === undefined
            ? ((await readProfiles(parentCwd)).get(profile)?.model ?? "")
            : `${answer.provider}/${answer.model}`;

    return {
        name: named?.name ?? "Agent",
        profile,
        model,
        session: id,
        fill: window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0,
        used,
        window,
        working: true,
        cwd: cwd ?? null,
    };
}

/** The profiles as the Extensions dialog lists them, by name. */
function profileRows(found: Map<string, Profile>): ProfileRow[] {
    return [...found.values()]
        .map((profile) => ({
            name: profile.name,
            description: profile.description,
            model: profile.model ?? null,
            thinking: typeof profile.thinking === "string" ? profile.thinking : null,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The action's args, checked: the name of a profile this server discovered, and a model or none. */
function setModelArgs(value: unknown): {
    profile: string;
    model: string | null;
    thinking: string | null;
} {
    if (typeof value !== "object" || value === null) {
        throw new ActionError("args must be { profile, model, thinking }");
    }

    const profile: unknown = Reflect.get(value, "profile");
    const model: unknown = Reflect.get(value, "model");
    const thinking: unknown = Reflect.get(value, "thinking");
    const name = typeof profile === "string" ? profile.trim() : "";

    if (name === "") {
        throw new ActionError("profile must be the name of an agent profile");
    }

    if (model !== null && (typeof model !== "string" || !/^\S+\/\S+$/.test(model))) {
        throw new ActionError("model must be provider/modelId, or null to name none");
    }

    if (thinking !== null && (typeof thinking !== "string" || thinking.trim() === "")) {
        throw new ActionError("thinking must be a thinking level, or null to name none");
    }

    return { profile: name, model, thinking };
}

export const actions = (host: Host): Record<string, Action> => ({
    async agents({ session }): Promise<NamedAgent[]> {
        if (session === null) {
            return [];
        }

        const { agents } = await host.readDoc(AgentsDoc, session.id);

        return Object.entries(agents)
            .map(([name, record]) => ({
                session: Number(record.conversationId),
                name,
                profile: record.agent,
            }))
            .toSorted((a, b) => a.session - b.session);
    },
    async profiles({ session }): Promise<ProfileRow[]> {
        return profileRows(await readProfiles(session?.cwd ?? host.cwd));
    },
    async setModel({ args, session }): Promise<ProfileRow[]> {
        const edit = setModelArgs(args);
        const cwd = session?.cwd ?? host.cwd;
        const profile = (await readProfiles(cwd)).get(edit.profile);

        if (profile === undefined) {
            throw new ActionError(`Unknown agent profile: ${edit.profile}`);
        }

        // The client names a profile, never a path: the file is the one discovery found for it.
        await writeProfileModel(profile.filePath, { model: edit.model, thinking: edit.thinking });

        return profileRows(await readProfiles(cwd));
    },
    async strip({ session }): Promise<Strip> {
        if (session === null) {
            return { parent: null, agents: [] };
        }

        if (session.owner !== undefined) {
            const title = await host.sessionTitle(session.owner);

            return { parent: { id: session.owner, title: title ?? "New session" }, agents: [] };
        }

        const working = [...seen]
            .filter(([, child]) => child.owner === session.id && child.busy)
            .toSorted(([a], [b]) => a - b);

        if (working.length === 0) {
            return { parent: null, agents: [] };
        }

        // The parent's record is the one durable place that says who each child is.
        const { agents } = await host.readDoc(AgentsDoc, session.id);
        const named = new Map(
            Object.entries(agents).map(([name, record]) => [
                Number(record.conversationId),
                { name, profile: record.agent },
            ]),
        );

        return {
            parent: null,
            agents: await Promise.all(
                working.map(([id, child]) =>
                    stripAgent(host, id, child, named.get(id), session.cwd ?? host.cwd),
                ),
            ),
        };
    },
});

export default function subagents(host: Host) {
    host.onDispose(() => {
        seen.clear();
    });
    host.onCommit((view: CommitView) => {
        const { id, owner, cwd } = view.session;

        if (owner === undefined) {
            return;
        }

        const answer = view.entries.findLast((entry) => entry.kind === "pi.assistant")?.model?.[0];

        // The strip shows working agents only, so an idle one is not kept.
        if (view.busy) {
            seen.set(id, {
                owner,
                cwd,
                busy: true,
                answer: answer?.role === "assistant" ? answer : undefined,
            });
        } else {
            seen.delete(id);
        }
        host.notifySessionChanged(owner);
    });

    const spawn = defineTool({
        name: "agent_spawn",
        description:
            "Start a new agent from an existing Markdown profile in ~/.pi/agent/agents (or the project's .pi/agents) on a self-contained task. Model and thinking come only from the profile; overrides are forbidden. An invalid or unavailable model/thinking returns an error without starting an agent. Its tools run in `cwd` when given. Its result arrives as a message.",
        parameters: Type.Object(
            {
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
                cwd: Type.Optional(
                    Type.String({
                        description:
                            "Absolute folder the new agent's tools work in, e.g. a git worktree path; omit to inherit this conversation's folder.",
                    }),
                ),
            },
            { additionalProperties: false },
        ),
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

            const configured = await childAgent(api, profile, context);

            if ("error" in configured) {
                return reply(
                    `No agent was started. ${configured.error} Fix the Markdown profile or choose another existing profile; model and thinking overrides are not allowed.`,
                    true,
                );
            }

            const { change } = configured;
            const given = args.cwd?.trim() ?? "";
            // Resolved so that "/repo/" and "/repo/." are the one folder the agent is stored with.
            const folder = given === "" ? undefined : resolve(given);

            if (folder !== undefined && !(isAbsolute(given) && isDirectory(folder))) {
                return reply(
                    `No agent was started. cwd must be an absolute path to an existing folder, got "${given}".`,
                    true,
                );
            }

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

                // Not in createConversation: a task-owned child is copied from its owner, which overwrites it.
                await configure(tx, child.id, {
                    ...change,
                    ...(folder === undefined ? {} : { cwd: folder }),
                });
                const prompt = await tx.doc(ChildDoc, child.id);

                prompt.rules = !profile.replacesRules;
                prompt.skills = profile.skills ?? null;
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

            return reply(`Agent ${started.name} (${profile.name}) started. ${NO_WAIT}`);
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
                        {
                            name,
                            conversationId: found.conversationId,
                            message,
                            stops: found.stops ?? 0,
                        },
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
                    found.stops = (found.stops ?? 0) + 1;
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
            // Agents get no agents of their own: no tools (see `childAgent`) and no profile list.
            section("agents", async (input, context) => {
                if (
                    (await input.read.snapshot(ChildDoc, input.conversationId, context)) !==
                    undefined
                ) {
                    return undefined;
                }

                const profiles = await readProfiles(input.agent.cwd ?? host.cwd);
                const list = [...profiles.values()]
                    .map((profile) => `- ${profile.name}: ${profile.description}`)
                    .join("\n");

                return `${GUIDE}\n\nProfiles:\n${list || "- none: add one to ~/.pi/agent/agents"}`;
            }),
        ],
        // Pi's `system-prompt: replace` and `skills`, by section key: whichever extension renders them.
        wraps: [
            wrapSection("rules", (rules) => ({
                ...rules,
                render: async (input, context) =>
                    (await input.read.snapshot(ChildDoc, input.conversationId, context))?.rules ===
                    false
                        ? undefined
                        : rules.render(input, context),
            })),
            wrapSection("skills", (skills) => ({
                ...skills,
                render: async (input, context) => {
                    const wanted = (
                        await input.read.snapshot(ChildDoc, input.conversationId, context)
                    )?.skills;

                    if (wanted === undefined || wanted === null) {
                        return skills.render(input, context);
                    }

                    const names = new Set(input.agent.tools.map((tool) => tool.name));
                    // As the skills section itself: a skill is loaded by reading its file.
                    const reader = (["read", "bash"] as const).find((name) => names.has(name));
                    const listed = skillsFor(input.agent.cwd ?? host.cwd).filter((skill) =>
                        wanted.includes(skill.name),
                    );

                    return reader === undefined || listed.length === 0
                        ? undefined
                        : formatSkillsForPrompt(listed, reader).trim() || undefined;
                },
            })),
        ],
    });
}
