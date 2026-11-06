import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { Context } from "@earendil-works/chord/context";
import {
    type ConversationId,
    configure,
    defineTool,
    LiveDoc,
    type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";

import type { Host } from "../../../server/sdk.ts";
import { answerText } from "./answer.ts";
import { childAgent } from "./child-agent.ts";
import { AgentsDoc, ChildDoc } from "./docs.ts";
import { readProfiles } from "./profiles.ts";
import { Anchor, Reporter } from "./tasks.ts";

const NO_WAIT =
    "Its outcome arrives as a message automatically. Do not check its status or sleep to wait for it; end your turn or continue unrelated work.";

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

/** The four tools. `host` sets the new agents' session titles and says where profiles are read from. */
export function agentTools(host: Host) {
    const spawn = defineTool({
        name: "agent_spawn",
        description:
            "Start a new agent from an existing Markdown profile in ~/.pi/agent/agents (or the project's .pi/agents) on a self-contained task. Model and thinking come only from the profile; overrides are forbidden. An invalid or unavailable model/thinking returns an error without starting an agent. Its tools run in `cwd` when given. Its result arrives as a message.",
        parameters: obj({
            agent: str({ description: "Profile name, from the Agents section of the prompt." }),
            task: str({ description: "Self-contained task for the new agent." }),
            name: opt(
                str({
                    description:
                        "Name to address it by later; defaults to the title-cased profile name.",
                }),
            ),
            cwd: opt(
                str({
                    description:
                        "Absolute folder the new agent's tools work in, e.g. a git worktree path; omit to inherit this conversation's folder.",
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
        parameters: obj(
            {
                name: str({ description: "Exact name of the agent." }),
                message: str({ description: "What to send." }),
            },
            { open: true },
        ),
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
        parameters: obj({ name: str({ description: "Exact name of the agent." }) }, { open: true }),
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
        parameters: obj(
            {
                name: opt(str({ description: "Exact name of one agent; omit to list them all." })),
            },
            { open: true },
        ),
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

    return [spawn, send, stop, status];
}
