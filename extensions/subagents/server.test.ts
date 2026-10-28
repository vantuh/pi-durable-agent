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
    LiveDoc,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type { CommitListener, Host } from "../../server/sdk.ts";
import { strip as stripRef } from "./refs.ts";
import subagents, { actions } from "./server.ts";

const context = BACKGROUND_CONTEXT;

type Wiring = {
    listeners: CommitListener[];
    disposers: (() => void | Promise<void>)[];
    windowOf: () => number | undefined;
};

function hostOf(cwd: string, titles: Map<number, string>, wiring: Wiring): Host {
    return {
        name: "subagents",
        cwd,
        dataDir: cwd,
        log: () => undefined,
        onCommit: (listener) => {
            wiring.listeners.push(listener);
        },
        onDispose: (dispose) => {
            wiring.disposers.push(dispose);
        },
        shapeModelRequests: () => undefined,
        registerModelProvider: () => () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => wiring.windowOf(),
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: (session) => Promise.resolve(titles.get(session) ?? null),
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
    let wiring: Wiring;
    let host: Host;
    let previousAgentDir: string | undefined;
    const faux = fauxProvider({
        models: [
            { id: "parent", reasoning: true },
            { id: "profile", reasoning: true },
            { id: "no-thinking", reasoning: false },
        ],
    });
    const profileModel = `${faux.provider.id}/profile`;
    const locked = fauxProvider({ provider: "locked", models: [{ id: "profile" }] });

    async function writeProfile(fields: string): Promise<void> {
        await writeFile(
            join(dir, ".pi", "agents", "counter.md"),
            `---\nname: counter\ndescription: Counts things\ntools: read, grep\n${fields}\n---\n\nYou count.\n`,
        );
    }

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
        await writeProfile(`model: ${profileModel}\nthinking: low`);

        const models = createModels();

        models.setProvider(faux.provider);
        models.setProvider({
            ...locked.provider,
            auth: { apiKey: { name: "Locked", resolve: () => Promise.resolve(undefined) } },
        });
        titles = new Map();
        wiring = { listeners: [], disposers: [], windowOf: () => undefined };
        host = hostOf(dir, titles, wiring);

        const registry = createRegistry();

        registry.install(CodingTools);
        registry.install(subagents(host));
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
                    thinkingLevel: "high",
                    cwd: dir,
                },
            },
            context,
        );
    });

    afterEach(async () => {
        await harness.close(context);
        for (const dispose of wiring.disposers) {
            await dispose();
        }
        process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
        await rm(dir, { recursive: true, force: true });
    });

    void it("runs the agent in its own conversation and reports its answer to the parent", async () => {
        const step = scripted(
            () => Promise.resolve(fauxAssistantMessage("There are 42.")),
            (said) =>
                said === "count them"
                    ? call("agent_spawn", { agent: "counter", task: "Count the files." })
                    : said === "continue"
                      ? call("agent_send", { name: "Counter", message: "Count again." })
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

        assert.ok(child);
        const agent = await child.agent(context);

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
        assert.deepEqual(agent?.model, { provider: faux.provider.id, modelId: "profile" });
        assert.equal(agent?.thinkingLevel, "low");

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
            agent: "Counter",
            profile: "counter",
        });

        await writeProfile(`model: ${faux.provider.id}/parent\nthinking: high`);
        await (await parent.submit({ type: "input", content: "continue" }, context)).wait(context);
        await reportersDone();
        await parent.waitForIdle(context);

        const continued = await child.agent(context);

        assert.equal((await userTexts(child.id)).at(-1), "Count again.");
        assert.deepEqual(continued?.model, { provider: faux.provider.id, modelId: "profile" });
        assert.equal(continued?.thinkingLevel, "low");
    });

    for (const test of [
        { label: "unknown profile", extra: { agent: "invented" }, error: /Unknown agent profile/ },
        { label: "missing model", fields: "thinking: low", error: /model.*required/i },
        { label: "malformed model", fields: "model: broken", error: /provider\/modelId/ },
        {
            label: "unknown model",
            fields: `model: ${faux.provider.id}/missing`,
            error: /missing.*not available/,
        },
        {
            label: "unavailable provider",
            fields: "model: unavailable-provider/model",
            error: /unavailable-provider\/model.*not available/,
        },
        {
            label: "unauthenticated model",
            fields: "model: locked/profile",
            error: /locked\/profile.*not available/,
        },
        {
            label: "non-string thinking",
            fields: `model: ${profileModel}\nthinking: 7`,
            error: /thinking.*7.*not supported/,
        },
        {
            label: "null thinking",
            fields: `model: ${profileModel}\nthinking: null`,
            error: /thinking.*null.*not supported/,
        },
        {
            label: "invalid thinking",
            fields: `model: ${profileModel}\nthinking: turbo`,
            error: /thinking.*turbo.*not supported/,
        },
        {
            label: "unsupported thinking",
            fields: `model: ${faux.provider.id}/no-thinking\nthinking: high`,
            error: /thinking.*high.*not supported/,
        },
        { label: "model override", extra: { model: profileModel }, error: /additional/i },
        { label: "thinking override", extra: { thinking: "low" }, error: /additional/i },
        { label: "thinkingLevel override", extra: { thinkingLevel: "low" }, error: /additional/i },
    ]) {
        void it(`rejects ${test.label} without creating an agent`, async () => {
            if (test.fields !== undefined) {
                await writeProfile(test.fields);
            }

            const step = scripted(
                () => Promise.resolve(fauxAssistantMessage("Should not run.")),
                (said) =>
                    said === "spawn"
                        ? call("agent_spawn", {
                              agent: "counter",
                              task: "Count.",
                              ...test.extra,
                          })
                        : fauxAssistantMessage("ok"),
            );

            faux.setResponses(Array.from({ length: 10 }, () => step));
            await (await parent.submit({ type: "input", content: "spawn" }, context)).wait(context);
            await reportersDone();
            await parent.waitForIdle(context);

            const entries = await harness.commit(
                (tx) => tx.scanEntries({ conversationId: parent.id }, 100),
                context,
            );
            const result = entries.items
                .flatMap((entry) => entry.model ?? [])
                .find((message) => message.role === "toolResult");

            assert.ok(result?.role === "toolResult");
            assert.equal(result.isError, true);
            assert.match(
                result.content
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join(""),
                test.error,
            );
            assert.equal(titles.size, 0);
            const conversations = await harness.commit(
                (tx) => tx.scanConversations({}, 100),
                context,
            );

            assert.deepEqual(
                conversations.items.map((record) => record.id),
                [parent.id],
            );
        });
    }

    void it("defaults omitted profile thinking to off, not the parent's level", async () => {
        await writeProfile(`model: ${profileModel}`);
        const step = scripted(
            () => Promise.resolve(fauxAssistantMessage("Done.")),
            (said) =>
                said === "spawn"
                    ? call("agent_spawn", { agent: "counter", task: "Count." })
                    : fauxAssistantMessage("ok"),
        );

        faux.setResponses(Array.from({ length: 10 }, () => step));
        await (await parent.submit({ type: "input", content: "spawn" }, context)).wait(context);
        await reportersDone();
        const conversations = await harness.commit((tx) => tx.scanConversations({}, 100), context);
        const child = conversations.items.find((record) => record.id !== parent.id);

        assert.ok(child);
        const conversation = await harness.conversation(child.id, context);

        assert.equal((await conversation?.agent(context))?.thinkingLevel, "off");
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
    void describe("strip", () => {
        const strip = async (session: number | null) =>
            stripRef.parse(
                await actions(host)["strip"]?.({
                    args: undefined,
                    session: session === null ? null : { id: session, cwd: dir },
                }),
            );

        /** Feeds the commit listeners the way the server does after each commit. */
        async function observe(conversation: Conversation): Promise<void> {
            const page = await harness.commit(
                (tx) =>
                    tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, 100),
                context,
            );
            const busy =
                (await harness.snapshot(LiveDoc, conversation.id, context))?.run !== undefined;

            for (const listener of wiring.listeners) {
                await listener({
                    session: { id: conversation.id, cwd: dir },
                    entries: page.items,
                    busy,
                });
            }
        }

        async function lastAnswer(id: ConversationId): Promise<AssistantMessage | undefined> {
            const page = await harness.commit(
                (tx) => tx.scanEntries({ conversationId: id, order: "ascending" }, 100),
                context,
            );
            const message = page.items.findLast((entry) => entry.kind === "pi.assistant")
                ?.model?.[0];

            return message?.role === "assistant" ? message : undefined;
        }

        async function untilWorking(conversation: Conversation): Promise<void> {
            for (let attempt = 0; attempt < 300; attempt++) {
                if (
                    (await harness.snapshot(LiveDoc, conversation.id, context))?.run !== undefined
                ) {
                    return;
                }

                await delay(10);
            }

            assert.fail("the agent never started working");
        }

        async function childOfParent(): Promise<Conversation> {
            const childId = [...titles.keys()].find((id) => id !== parent.id);

            assert.ok(childId !== undefined);

            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came from the conversation the tool created
            const child = await harness.conversation(childId as ConversationId, context);

            assert.ok(child);

            return child;
        }

        void it("lists only working agents, with the context they hold, and gives a child its parent", async () => {
            let release: () => void = () => undefined;
            let childRuns = 0;
            const step = scripted(
                () => {
                    childRuns += 1;

                    return childRuns === 1
                        ? Promise.resolve(fauxAssistantMessage("First answer."))
                        : new Promise((resolve) => {
                              release = () => {
                                  resolve(fauxAssistantMessage("Second answer."));
                              };
                          });
                },
                (said) =>
                    said === "count them"
                        ? call("agent_spawn", { agent: "counter", task: "Count the files." })
                        : said === "continue"
                          ? call("agent_send", { name: "Counter", message: "Count again." })
                          : fauxAssistantMessage("ok"),
            );

            titles.set(parent.id, "Main work");
            faux.setResponses(Array.from({ length: 10 }, () => step));
            await (
                await parent.submit({ type: "input", content: "count them" }, context)
            ).wait(context);
            await reportersDone();
            await parent.waitForIdle(context);

            const child = await childOfParent();

            await observe(parent);
            await observe(child);
            assert.deepEqual(
                await strip(parent.id),
                { parent: null, agents: [] },
                "idle agents are not shown",
            );

            const answer = await lastAnswer(child.id);

            assert.ok(answer);

            const used =
                answer.usage.input +
                answer.usage.output +
                answer.usage.cacheRead +
                answer.usage.cacheWrite;

            assert.ok(used > 0);
            wiring.windowOf = () => used * 4;

            await (
                await parent.submit({ type: "input", content: "continue" }, context)
            ).wait(context);
            await untilWorking(child);
            await observe(child);

            assert.deepEqual((await strip(parent.id)).agents, [
                {
                    name: "Counter",
                    profile: "counter",
                    model: `${faux.provider.id}/profile`,
                    session: child.id,
                    fill: 25,
                    used,
                    window: used * 4,
                    working: true,
                },
            ]);
            assert.deepEqual(await strip(child.id), {
                parent: { id: parent.id, title: "Main work" },
                agents: [],
            });

            release();
            await reportersDone();
            await parent.waitForIdle(context);
            await observe(child);

            assert.deepEqual(await strip(parent.id), { parent: null, agents: [] });
        });

        void it("is empty for a session with no agents and for none at all", async () => {
            await observe(parent);

            assert.deepEqual(await strip(parent.id), { parent: null, agents: [] });
            assert.deepEqual(await strip(null), { parent: null, agents: [] });
        });
    });
});
