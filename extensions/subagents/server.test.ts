import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    type AssistantMessage,
    createModels,
    fauxAssistantMessage,
    type FauxResponseFactory,
    fauxProvider,
    fauxToolCall,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
    type Conversation,
    type ConversationId,
    createRegistry,
    Harness,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type { Host } from "../../server/sdk.ts";
import subagents from "./server.ts";

const context = BACKGROUND_CONTEXT;

function hostOf(cwd: string, titles: Map<number, string>): Host {
    return {
        name: "subagents",
        cwd,
        dataDir: cwd,
        log: () => undefined,
        onCommit: () => undefined,
        onDispose: () => undefined,
        shapeModelRequests: () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        setSessionTitle: (session, title) => {
            titles.set(session, title);
            return Promise.resolve();
        },
        setSessionMark: () => undefined,
    };
}

function lastText(request: TranscriptContext): string {
    const last = request.messages.at(-1);

    if (last?.role === "toolResult") {
        return `tool:${last.toolName}`;
    }

    if (last?.role !== "user") {
        return "";
    }

    return typeof last.content === "string"
        ? last.content
        : last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function call(name: string, args: Record<string, string>): AssistantMessage {
    return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

/** Every request, parent's and child's, goes through one script: who is asking is in its prompt. */
function scripted(
    child: (
        request: TranscriptContext,
        signal: AbortSignal | undefined,
    ) => Promise<AssistantMessage>,
    parent: (said: string) => AssistantMessage,
): FauxResponseFactory {
    return (request, options) =>
        JSON.stringify(request.messages.filter((message) => message.role === "system")).includes(
            "## Agent protocol",
        )
            ? child(request, options?.signal)
            : parent(lastText(request));
}

void describe("subagents", () => {
    let dir: string;
    let harness: Harness;
    let parent: Conversation;
    let titles: Map<number, string>;
    let previousAgentDir: string | undefined;
    const faux = fauxProvider();

    async function userTexts(id: ConversationId): Promise<string[]> {
        const page = await harness.commit(
            (tx) => tx.scanEntries({ conversationId: id, order: "ascending" }, 100),
            context,
        );

        return page.items.flatMap((entry) => {
            const message = entry.model?.[0];

            if (message?.role !== "user") {
                return [];
            }

            return typeof message.content === "string"
                ? [message.content]
                : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
        });
    }

    async function reportersDone(): Promise<void> {
        for (;;) {
            const live = await harness.commit(
                (tx) => tx.scanTasks({ kind: "subagents.reporter" }, 100),
                context,
            );

            if (live.items.every((task) => task.state.status === "terminal")) {
                return;
            }

            await delay(10);
        }
    }

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "subagents-"));
        previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
        process.env["PI_CODING_AGENT_DIR"] = join(dir, "agent");
        await mkdir(join(dir, ".pi", "agents"), { recursive: true });
        await writeFile(
            join(dir, ".pi", "agents", "counter.md"),
            "---\nname: counter\ndescription: Counts things\ntools: read, grep\n---\n\nYou count.\n",
        );

        const models = createModels();

        models.setProvider(faux.provider);
        titles = new Map();

        const registry = createRegistry();

        registry.install(CodingTools);
        registry.install(subagents(hostOf(dir, titles)));
        harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry, env: () => new NodeExecutionEnv({ cwd: dir }) },
            context,
        );
        harness.resume();
        parent = await harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: {
                    model: { provider: faux.provider.id, modelId: faux.getModel().id },
                    cwd: dir,
                },
            },
            context,
        );
    });

    afterEach(async () => {
        await harness.close(context);
        process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
        await rm(dir, { recursive: true, force: true });
    });

    void it("runs the agent in its own conversation and reports its answer to the parent", async () => {
        const step = scripted(
            () => Promise.resolve(fauxAssistantMessage("There are 42.")),
            (said) =>
                said === "count them"
                    ? call("agent_spawn", { agent: "counter", task: "Count the files." })
                    : fauxAssistantMessage("ok"),
        );

        faux.setResponses(Array.from({ length: 10 }, () => step));
        await (
            await parent.submit({ type: "input", content: "count them" }, context)
        ).wait(context);
        await reportersDone();
        await parent.waitForIdle(context);

        const texts = await userTexts(parent.id);

        assert.equal(texts.at(-1), "[agent Counter (counter) finished]\n\nThere are 42.");

        const [childId, title] = [...titles][0] ?? [];

        assert.equal(title, "Counter: Count the files.");
        assert.ok(childId !== undefined);

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came from the conversation the tool created
        const child = await harness.conversation(childId as ConversationId, context);
        const agent = await child?.agent(context);

        assert.deepEqual(
            agent?.tools.map((tool) => tool.name),
            ["read"],
            "only the profile's tools that exist, and no agent tools of its own",
        );
        assert.ok(
            agent?.extensions.every((extension) => extension.name !== "subagents"),
            "a profile without a tools list still gets no agents of its own",
        );
        assert.match(agent?.instructions ?? "", /^You count\.\n\n## Agent protocol/);

        const written = async (id: number, kind: string) =>
            (
                await harness.commit(
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id the harness gave out
                    (tx) => tx.scanEntries({ conversationId: id as ConversationId }, 100),
                    context,
                )
            ).items.find((entry) => entry.kind === kind)?.data;

        assert.deepEqual(
            await written(parent.id, "subagents.report"),
            { text: "There are 42.", author: "Counter", session: childId },
            "the screen shows the answer under the agent's name, with the way to its conversation",
        );
        assert.deepEqual(await written(childId, "subagents.instruction"), {
            text: "Count the files.",
            author: "Orchestrator",
            session: parent.id,
        });
    });

    void it("reports nothing for a run agent_stop ended", async () => {
        let childStarted: () => void = () => undefined;
        const working = new Promise<void>((resolve) => {
            childStarted = resolve;
        });
        const step = scripted(
            (_request, signal) =>
                new Promise((resolve) => {
                    childStarted();
                    signal?.addEventListener("abort", () => {
                        resolve(fauxAssistantMessage("", { stopReason: "aborted" }));
                    });
                }),
            (said) => {
                if (said === "count them") {
                    return call("agent_spawn", { agent: "counter", task: "Count." });
                }

                return said === "stop it"
                    ? call("agent_stop", { name: "Counter" })
                    : fauxAssistantMessage("ok");
            },
        );

        faux.setResponses(Array.from({ length: 10 }, () => step));
        await (
            await parent.submit({ type: "input", content: "count them" }, context)
        ).wait(context);
        await working;
        await (await parent.submit({ type: "input", content: "stop it" }, context)).wait(context);
        await reportersDone();
        await parent.waitForIdle(context);

        assert.deepEqual(await userTexts(parent.id), ["count them", "stop it"]);
    });
});
