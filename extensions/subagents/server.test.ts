import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    defineExtension,
    type EntryRecord,
    Harness,
    LiveDoc,
    section,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import { ActionError, type CommitListener, type Host } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { schemasSent } from "../../test/fixtures/tool-schemas.ts";
import {
    agents as agentsRef,
    profiles as profilesRef,
    type ProfileRow,
    strip as stripRef,
} from "./refs.ts";
import subagents, { actions } from "./server.ts";

const context = BACKGROUND_CONTEXT;

type Wiring = {
    listeners: CommitListener[];
    disposers: (() => void | Promise<void>)[];
    windowOf: () => number | undefined;
    notified: number[];
    /** Set once the harness is open; `host.readDoc` reads through it, as the server does. */
    harness: Harness | undefined;
    /** How many times the extension read a document. */
    reads: number;
};

function hostOf(cwd: string, titles: Map<number, string>, wiring: Wiring): Host {
    return testHost({
        name: "subagents",
        cwd,
        dataDir: cwd,
        onCommit: (listener) => {
            wiring.listeners.push(listener);
        },
        onDispose: (dispose) => {
            wiring.disposers.push(dispose);
        },
        contextWindow: () => wiring.windowOf(),
        sessionTitle: (session) => Promise.resolve(titles.get(session) ?? null),
        sessionName: (session) => Promise.resolve(titles.get(session) ?? null),
        setSessionTitle: (session, title) => {
            titles.set(session, title);
            return Promise.resolve();
        },
        readDoc: async (doc, session) => {
            wiring.reads += 1;

            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came from a conversation this test created
            const id = session as ConversationId;

            return (await wiring.harness?.snapshot(doc, id, context)) ?? doc.definition.initial();
        },
        notifySessionChanged: (session) => {
            wiring.notified.push(session);
        },
    });
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
    let registry: ReturnType<typeof createRegistry>;
    let installed: ReturnType<typeof subagents>;
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

    async function writeProfile(fields: string, tools = "tools: read, grep"): Promise<void> {
        await writeFile(
            join(dir, ".pi", "agents", "counter.md"),
            `---\nname: counter\ndescription: Counts things\n${tools}\n${fields}\n---\n\nYou count.\n`,
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
        wiring = {
            listeners: [],
            disposers: [],
            windowOf: () => undefined,
            notified: [],
            harness: undefined,
            reads: 0,
        };
        host = hostOf(dir, titles, wiring);

        registry = createRegistry();

        registry.install(CodingTools);
        installed = subagents(host);
        registry.install(installed);
        harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dir }) },
            context,
        );
        wiring.harness = harness;
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
            {
                text: "There are 42.",
                author: "Counter",
                session: childId,
                model: profileModel,
            },
            "the screen shows the answer under the agent's name, the model that answered, and the way to its conversation",
        );
        assert.deepEqual(await written(childId, "subagents.instruction"), {
            text: "Count the files.",
            author: "Orchestrator",
            session: parent.id,
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

    void it("names the engine the provider reported, not the model it was asked for", async () => {
        const step = scripted(
            // A router: the profile names one model, the provider says another served it.
            () =>
                Promise.resolve({
                    ...fauxAssistantMessage("There are 42."),
                    responseModel: "profile-2026-02-19",
                }),
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

        const childId = [...titles.keys()].at(0);
        const entries = await harness.commit(
            (tx) => tx.scanEntries({ conversationId: parent.id }, 100),
            context,
        );

        assert.deepEqual(
            entries.items.find((entry) => entry.kind === "subagents.report")?.data,
            {
                text: "There are 42.",
                author: "Counter",
                session: childId,
                model: `${faux.provider.id}/profile-2026-02-19`,
            },
            "a report names the engine that answered it, as the answer entry says",
        );
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
        {
            label: "scalar tools",
            tools: "tools: 7",
            error: /tools.*list of names/,
        },
        {
            label: "tools with a non-string item",
            tools: "tools: [read, 7]",
            error: /tools.*list of names/,
        },
        {
            label: "tools that is a mapping",
            tools: "tools: {read: true}",
            error: /tools.*list of names/,
        },
        { label: "model override", extra: { model: profileModel }, error: /unknown field/i },
        { label: "thinking override", extra: { thinking: "low" }, error: /unknown field/i },
        {
            label: "thinkingLevel override",
            extra: { thinkingLevel: "low" },
            error: /unknown field/i,
        },
    ]) {
        void it(`rejects ${test.label} without creating an agent`, async () => {
            if (test.fields !== undefined || test.tools !== undefined) {
                await writeProfile(test.fields ?? `model: ${profileModel}`, test.tools);
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

    async function spawnIn(
        args: Record<string, string>,
        child: (request: TranscriptContext) => Promise<AssistantMessage> = () =>
            Promise.resolve(fauxAssistantMessage("Done.")),
    ): Promise<{
        text: string;
        isError: boolean;
        childIds: ConversationId[];
    }> {
        const step = scripted(child, (said) =>
            said === "spawn"
                ? call("agent_spawn", { agent: "counter", task: "Count.", ...args })
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

        const conversations = await harness.commit((tx) => tx.scanConversations({}, 100), context);

        return {
            text: result.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join(""),
            isError: result.isError,
            childIds: conversations.items
                .filter((record) => record.id !== parent.id)
                .map((record) => record.id),
        };
    }

    async function cwdOf(id: ConversationId | undefined): Promise<string | undefined> {
        assert.ok(id !== undefined);

        const conversation = await harness.conversation(id, context);

        return (await conversation?.agent(context))?.cwd;
    }

    for (const test of [
        { label: "an empty list", tools: "tools: []" },
        { label: "an empty value", tools: "tools:" },
        { label: "an empty string", tools: 'tools: ""' },
        { label: "only unknown names", tools: "tools: nothing, nowhere" },
    ]) {
        void it(`gives an agent no tools for ${test.label}, not the parent's`, async () => {
            await writeProfile(`model: ${profileModel}`, test.tools);

            const spawned = await spawnIn({});

            assert.equal(spawned.isError, false);
            assert.equal(spawned.childIds.length, 1);

            const id = spawned.childIds[0];

            assert.ok(id !== undefined);
            const child = await harness.conversation(id, context);

            assert.deepEqual(
                (await child?.agent(context))?.tools.map((tool) => tool.name),
                [],
            );
        });
    }

    void describe("an agent's prompt", () => {
        const systemOf = (request: TranscriptContext): string =>
            JSON.stringify(request.messages.filter((message) => message.role === "system"));

        /** The parent's and the child's system prompts, with a stand-in for the rules and skills sections. */
        async function prompts(fields: string): Promise<{ parent: string; child: string }> {
            registry.install(
                defineExtension({
                    name: "stand-in",
                    sections: [
                        section("rules", () => "RULES-TEXT"),
                        section("skills", () => "ALL-SKILLS"),
                        section("other", () => "OTHER-TEXT"),
                    ],
                }),
            );
            await mkdir(join(dir, ".agents", "skills", "alpha"), { recursive: true });
            await writeFile(
                join(dir, ".agents", "skills", "alpha", "SKILL.md"),
                "---\nname: alpha\ndescription: The alpha skill\n---\n\nDo alpha.\n",
            );
            await writeProfile(`model: ${profileModel}\n${fields}`);

            let child = "";
            let parentPrompt = "";
            const step = scripted(
                (request) => {
                    child = systemOf(request);

                    return Promise.resolve(fauxAssistantMessage("Done."));
                },
                (said) =>
                    said === "spawn"
                        ? call("agent_spawn", { agent: "counter", task: "Count." })
                        : fauxAssistantMessage("ok"),
            );

            faux.setResponses(
                Array.from({ length: 10 }, () => (...args: Parameters<FauxResponseFactory>) => {
                    const system = systemOf(args[0]);

                    if (!system.includes("## Agent protocol")) {
                        parentPrompt = system;
                    }

                    return step(...args);
                }),
            );
            await (await parent.submit({ type: "input", content: "spawn" }, context)).wait(context);
            await reportersDone();
            await parent.waitForIdle(context);

            return { parent: parentPrompt, child };
        }

        void it("drops the rules for system-prompt: replace and lists only the named skills", async () => {
            const { parent: parentPrompt, child } = await prompts(
                "system-prompt: replace\nskills: alpha, missing",
            );

            assert.match(parentPrompt, /RULES-TEXT/);
            assert.match(parentPrompt, /ALL-SKILLS/);
            assert.doesNotMatch(child, /RULES-TEXT/);
            assert.doesNotMatch(child, /ALL-SKILLS/);
            assert.match(child, /<name>alpha<\/name>/);
            assert.match(child, /OTHER-TEXT/);
        });

        void it("lists no skills for skills: none", async () => {
            const { child } = await prompts("skills: none");

            assert.match(child, /RULES-TEXT/);
            assert.doesNotMatch(child, /ALL-SKILLS|<available_skills>/);
        });

        void it("keeps the parent's sections without those fields, but not the profile list", async () => {
            const { parent: parentPrompt, child } = await prompts("");

            assert.match(parentPrompt, /Profiles:/);
            assert.match(parentPrompt, /Repository facts/);
            assert.match(parentPrompt, /independent review/);
            assert.match(parentPrompt, /one writer per worktree/);
            assert.match(parentPrompt, /only when a profile of that name is listed/);
            assert.match(child, /RULES-TEXT/);
            assert.match(child, /ALL-SKILLS/);
            assert.doesNotMatch(child, /Profiles:/);
            assert.doesNotMatch(child, /Repository facts|independent review|one writer/);
        });

        void it("has no delegation policy once the extension is uninstalled", async () => {
            registry.install(
                defineExtension({
                    name: "stand-in",
                    sections: [section("other", () => "OTHER-TEXT")],
                }),
            );
            registry.uninstall(installed);

            let prompt = "";

            faux.setResponses([
                (request) => {
                    prompt = systemOf(request);

                    return fauxAssistantMessage("ok");
                },
            ]);
            await (await parent.submit({ type: "input", content: "hi" }, context)).wait(context);

            assert.match(prompt, /OTHER-TEXT/);
            assert.doesNotMatch(prompt, /## Agents|Repository facts|Profiles:/);
        });
    });

    void it("lets an agent inherit the parent's tools when the profile has no tools key", async () => {
        await writeFile(
            join(dir, ".pi", "agents", "counter.md"),
            `---\nname: counter\ndescription: Counts things\nmodel: ${profileModel}\n---\n\nYou count.\n`,
        );

        const spawned = await spawnIn({});
        const id = spawned.childIds[0];

        assert.ok(id !== undefined);

        const names = (await (await harness.conversation(id, context))?.agent(context))?.tools.map(
            (tool) => tool.name,
        );

        assert.ok(names !== undefined);
        assert.ok(names.includes("read") && names.includes("bash"));
        assert.ok(names.every((name) => !name.startsWith("agent_")));
    });

    void it("runs an agent's tools in the folder agent_spawn is given", async () => {
        const worktree = join(dir, "worktree");

        await mkdir(worktree);
        await writeFile(join(worktree, "marker.txt"), "only in the worktree");

        const spawned = await spawnIn({ cwd: `  ${worktree}  ` }, (request) =>
            Promise.resolve(
                request.messages.at(-1)?.role === "toolResult"
                    ? fauxAssistantMessage("Done.")
                    : call("read", { path: "marker.txt" }),
            ),
        );

        assert.equal(spawned.isError, false);
        assert.equal(spawned.childIds.length, 1);
        assert.equal(await cwdOf(spawned.childIds[0]), worktree);
        assert.equal(await cwdOf(parent.id), dir, "the parent keeps its own folder");

        const entries = await harness.commit(
            (tx) => tx.scanEntries({ conversationId: spawned.childIds[0] ?? parent.id }, 100),
            context,
        );
        const read = entries.items
            .flatMap((entry) => entry.model ?? [])
            .find((message) => message.role === "toolResult");

        assert.ok(read?.role === "toolResult");
        assert.equal(read.isError, false);
        assert.match(
            read.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
            /only in the worktree/,
            "the agent's own tool read a file that exists only in that folder",
        );
    });

    void it("stores the canonical folder when the path has a trailing slash or dot", async () => {
        const worktree = join(dir, "worktree");

        await mkdir(worktree);

        const known = new Set<ConversationId>();

        for (const [n, cwd] of [
            `${worktree}/`,
            `${worktree}/.`,
            join(worktree, "..", "worktree"),
        ].entries()) {
            const spawned = await spawnIn({ cwd, name: `Agent ${String(n)}` });
            const fresh = spawned.childIds.filter((id) => !known.has(id));

            assert.equal(fresh.length, 1, cwd);
            assert.equal(await cwdOf(fresh[0]), worktree, cwd);
            fresh.forEach((id) => known.add(id));
        }
    });

    for (const cwd of ["", "   "]) {
        void it(`keeps the parent's folder for ${JSON.stringify(cwd)}`, async () => {
            const spawned = await spawnIn(cwd === "" ? {} : { cwd });

            assert.equal(spawned.isError, false);
            assert.equal(spawned.childIds.length, 1);
            assert.equal(await cwdOf(spawned.childIds[0]), dir);
        });
    }

    void it("refuses a folder that is relative, missing or a file, and starts no agent", async () => {
        await mkdir(join(dir, "relative"));
        await writeFile(join(dir, "file.txt"), "not a folder");

        // "extensions" and "." exist relative to the process, so only the absolute-path rule refuses them.
        for (const cwd of [
            "relative",
            "extensions",
            ".",
            join(dir, "missing"),
            join(dir, "file.txt"),
        ]) {
            const spawned = await spawnIn({ cwd });

            assert.equal(spawned.isError, true, cwd);
            assert.ok(spawned.text.includes(cwd), spawned.text);
            assert.doesNotMatch(
                spawned.text,
                /unknown field/i,
                "refused by the tool, not the schema",
            );
            assert.deepEqual(spawned.childIds, [], cwd);
        }

        assert.equal(titles.size, 0);
    });

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
    void it("starts nothing a stop came before, and the agent still continues with agent_send", async () => {
        let requests = 0;
        let stopAfterSend = false;
        let held: Promise<void> | undefined;
        const step = scripted(
            () => {
                requests += 1;

                return Promise.resolve(fauxAssistantMessage(`Done ${requests}.`));
            },
            (said) => {
                if (said === "count them") {
                    return call("agent_spawn", { agent: "counter", task: "Count." });
                }

                if (said === "hold it") {
                    stopAfterSend = true;

                    return call("agent_send", { name: "Counter", message: "Count again." });
                }

                if (said === "tool:agent_send" && stopAfterSend) {
                    return call("agent_stop", { name: "Counter" });
                }

                return said === "later"
                    ? call("agent_send", { name: "Counter", message: "Count once more." })
                    : fauxAssistantMessage("ok");
            },
        );
        const extension = subagents(host);

        // The Reporter is paused before it submits anything, as a slow scheduler would leave it.
        registry.install({
            ...extension,
            tasks: (extension.tasks ?? []).map((task) => {
                const deliver = task.definition.phases["deliver"];

                return typeof deliver === "function"
                    ? {
                          definition: {
                              ...task.definition,
                              phases: {
                                  ...task.definition.phases,
                                  deliver: async (...args: unknown[]) => {
                                      await held;

                                      return Reflect.apply(deliver, undefined, args);
                                  },
                              },
                          },
                      }
                    : task;
            }),
        });
        faux.setResponses(Array.from({ length: 20 }, () => step));
        await (
            await parent.submit({ type: "input", content: "count them" }, context)
        ).wait(context);
        await reportersDone();
        await parent.waitForIdle(context);
        assert.equal(requests, 1);

        let release: () => void = () => undefined;

        held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await (await parent.submit({ type: "input", content: "hold it" }, context)).wait(context);
        await parent.waitForIdle(context);
        release();
        await reportersDone();

        const [childId] = [...titles].map(([id]) => id);

        assert.ok(childId !== undefined);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came from the conversation the tool created
        const child = childId as ConversationId;

        assert.equal(
            requests,
            1,
            "the stopped agent did not run the message queued before the stop",
        );
        assert.deepEqual(await userTexts(child), ["Count."]);
        assert.equal((await userTexts(parent.id)).length, 3, "and nothing was reported for it");

        held = undefined;
        stopAfterSend = false;
        await (await parent.submit({ type: "input", content: "later" }, context)).wait(context);
        await reportersDone();
        await parent.waitForIdle(context);

        assert.deepEqual(await userTexts(child), ["Count.", "Count once more."]);
        assert.equal(
            (await userTexts(parent.id)).at(-1),
            "[agent Counter (counter) finished]\n\nDone 2.",
        );
    });

    void describe("profiles", () => {
        const session = () => ({ id: parent.id, cwd: dir });

        async function listed(): Promise<ProfileRow[]> {
            const action = actions(host)["profiles"];

            assert.ok(action !== undefined);

            return profilesRef.parse(await action({ args: undefined, session: session() }));
        }

        /** The refusal, checked as the route answers it: an `ActionError` is a 400. */
        async function rejection(promise: Promise<unknown>): Promise<ActionError> {
            let refused: ActionError | undefined;

            try {
                await promise;
            } catch (error) {
                assert.ok(error instanceof ActionError, `an ActionError, not ${String(error)}`);
                refused = error;
            }

            assert.ok(refused !== undefined, "it was expected to refuse");

            return refused;
        }

        async function write(args: unknown): Promise<ProfileRow[]> {
            const action = actions(host)["setModel"];

            assert.ok(action !== undefined);

            return profilesRef.parse(await action({ args, session: session() }));
        }

        void it("lists what each profile's frontmatter says, the project's file winning", async () => {
            await mkdir(join(dir, "agent", "agents"), { recursive: true });
            await writeFile(
                join(dir, "agent", "agents", "counter.md"),
                "---\nname: counter\ndescription: The user's counter\nmodel: user/model\n---\n\nYou count.\n",
            );

            assert.deepEqual(await listed(), [
                {
                    name: "counter",
                    description: "Counts things",
                    model: profileModel,
                    thinking: "low",
                },
            ]);
        });

        void it("writes the model and thinking into the profile's own file", async () => {
            await mkdir(join(dir, "agent", "agents"), { recursive: true });
            await writeFile(
                join(dir, "agent", "agents", "counter.md"),
                "---\nname: counter\ndescription: The user's counter\nmodel: user/model\n---\n\nYou count.\n",
            );

            assert.deepEqual(
                await write({ profile: "counter", model: "faux/checker", thinking: "high" }),
                [
                    {
                        name: "counter",
                        description: "Counts things",
                        model: "faux/checker",
                        thinking: "high",
                    },
                ],
            );

            assert.equal(
                await readFile(join(dir, ".pi", "agents", "counter.md"), "utf8"),
                '---\nname: counter\ndescription: Counts things\ntools: read, grep\nmodel: "faux/checker"\nthinking: "high"\n---\n\nYou count.\n',
            );
            assert.match(
                await readFile(join(dir, "agent", "agents", "counter.md"), "utf8"),
                /model: user\/model/,
                "the profile the project's file replaces is left alone",
            );
        });

        void it("clears the model and the thinking when it is given null for both", async () => {
            await write({ profile: "counter", model: null, thinking: null });

            const after = await readFile(join(dir, ".pi", "agents", "counter.md"), "utf8");

            assert.ok(!after.includes("model:"));
            assert.ok(!after.includes("thinking:"));
            assert.deepEqual(await listed(), [
                {
                    name: "counter",
                    description: "Counts things",
                    model: null,
                    thinking: null,
                },
            ]);
        });

        void it("refuses a profile it did not discover, and takes a name and never a path", async () => {
            for (const profile of ["../counter", "/etc/passwd", "not-a-profile"]) {
                assert.match(
                    (await rejection(write({ profile, model: "faux/checker", thinking: null })))
                        .message,
                    /Unknown agent profile/,
                );
            }
        });

        void it("refuses a model that is not provider/modelId", async () => {
            for (const model of ["profile", "faux/", "/profile", 7]) {
                assert.match(
                    (await rejection(write({ profile: "counter", model, thinking: null }))).message,
                    /model must be provider\/modelId/,
                );
            }

            assert.match(
                await readFile(join(dir, ".pi", "agents", "counter.md"), "utf8"),
                new RegExp(`model: ${profileModel}\n`),
                "the profile keeps the model it had",
            );
        });
    });

    void describe("strip", () => {
        /** What the core knows of a session: the conversation that started it, from its record. */
        async function ownerOf(id: number): Promise<number | undefined> {
            const page = await harness.commit((tx) => tx.scanConversations({}, 100), context);
            const record = page.items.find((candidate) => candidate.id === id);

            return record?.owner === undefined ? undefined : Number(record.owner.conversationId);
        }

        const strip = async (session: number | null) => {
            const owner = session === null ? undefined : await ownerOf(session);

            return stripRef.parse(
                await actions(host)["strip"]?.({
                    args: undefined,
                    session:
                        session === null
                            ? null
                            : { id: session, cwd: dir, ...(owner === undefined ? {} : { owner }) },
                }),
            );
        };

        /** Feeds the commit listeners the way the server does after each commit. */
        async function observe(
            conversation: Conversation,
            entries?: readonly EntryRecord[],
        ): Promise<void> {
            const page = await harness.commit(
                (tx) =>
                    tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, 100),
                context,
            );
            const busy =
                (await harness.snapshot(LiveDoc, conversation.id, context))?.run !== undefined;
            const owner = await ownerOf(conversation.id);

            for (const listener of wiring.listeners) {
                await listener({
                    session: {
                        id: conversation.id,
                        cwd: dir,
                        ...(owner === undefined ? {} : { owner }),
                    },
                    entries: entries ?? page.items,
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
            wiring.notified.length = 0;
            await observe(child);
            assert.deepEqual(
                wiring.notified,
                [parent.id],
                "a commit of the agent tells its parent",
            );
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
                    cwd: dir,
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

        void it("names a child from the parent's record, with no instruction entry and whatever its title says", async () => {
            faux.setResponses([
                scripted(
                    () => Promise.resolve(fauxAssistantMessage("never asked")),
                    (said) =>
                        said === "count them"
                            ? call("agent_spawn", { agent: "counter", task: "Count the files." })
                            : fauxAssistantMessage("ok"),
                ),
            ]);
            await (
                await parent.submit({ type: "input", content: "count them" }, context)
            ).wait(context);
            await reportersDone();
            await parent.waitForIdle(context);
            titles.set(parent.id, "Main work");

            const child = await childOfParent();
            const stranger = child.id + 1000;

            // A compaction set the instruction aside: the child's entries name nothing. A title
            // someone changed names nothing either.
            titles.set(child.id, "Renamed by hand");
            wiring.notified.length = 0;
            await wiring.listeners[0]?.({
                session: { id: child.id, cwd: dir, owner: parent.id },
                entries: [],
                busy: true,
            });
            // Owned by the parent, but not started by this extension: the parent has no record of it.
            await wiring.listeners[0]?.({
                session: { id: stranger, cwd: dir, owner: parent.id },
                entries: [],
                busy: true,
            });

            assert.deepEqual(wiring.notified, [parent.id, parent.id]);
            assert.deepEqual(await strip(child.id), {
                parent: { id: parent.id, title: "Main work" },
                agents: [],
            });

            wiring.reads = 0;

            assert.deepEqual(
                (await strip(parent.id)).agents.map((agent) => [
                    agent.session,
                    agent.name,
                    agent.profile,
                    agent.model,
                ]),
                [
                    [child.id, "Counter", "counter", profileModel],
                    [stranger, "Agent", "", ""],
                ],
            );
            assert.equal(wiring.reads, 1, "the parent's record is read once for all its children");
            assert.deepEqual(
                (await strip(parent.id)).agents.map((agent) => agent.cwd),
                [dir, dir],
            );
        });

        void it("reports the folder an agent works in, as spawned", async () => {
            const worktree = join(dir, "worktree");

            await mkdir(worktree);
            await spawnIn({ cwd: `${worktree}/.` }, () =>
                Promise.resolve(fauxAssistantMessage("never asked")),
            );

            const child = await childOfParent();
            const folder = (await child.agent(context))?.cwd;

            assert.equal(folder, worktree);
            await wiring.listeners[0]?.({
                session: { id: child.id, cwd: folder ?? null, owner: parent.id },
                entries: [],
                busy: true,
            });

            assert.deepEqual(
                (await strip(parent.id)).agents.map((agent) => [agent.session, agent.cwd]),
                [[child.id, worktree]],
            );
        });

        void it("names the model of an agent that has not answered from the parent's profiles, not the agent's folder", async () => {
            // Outside `dir`: profile discovery also walks up from a folder, and would find `dir/.pi`.
            const elsewhere = await mkdtemp(join(tmpdir(), "subagents-elsewhere-"));

            try {
                await spawnIn({ cwd: elsewhere }, () =>
                    Promise.resolve(fauxAssistantMessage("never asked")),
                );

                const child = await childOfParent();

                await wiring.listeners[0]?.({
                    session: { id: child.id, cwd: elsewhere, owner: parent.id },
                    entries: [],
                    busy: true,
                });

                assert.deepEqual(
                    (await strip(parent.id)).agents.map((agent) => [agent.model, agent.cwd]),
                    [[profileModel, elsewhere]],
                );
            } finally {
                await rm(elsewhere, { recursive: true, force: true });
            }
        });

        void it("reports no folder for an agent whose commit named none", async () => {
            await spawnIn({}, () => Promise.resolve(fauxAssistantMessage("never asked")));

            const child = await childOfParent();

            await wiring.listeners[0]?.({
                session: { id: child.id, cwd: null, owner: parent.id },
                entries: [],
                busy: true,
            });

            assert.deepEqual(
                (await strip(parent.id)).agents.map((agent) => agent.cwd),
                [null],
            );
        });

        void it("names every agent the parent started from its record, with one read", async () => {
            await writeFile(
                join(dir, ".pi", "agents", "checker.md"),
                `---\nname: checker\ndescription: Checks things\nmodel: ${profileModel}\n---\n\nYou check.\n`,
            );
            faux.setResponses(
                Array.from({ length: 10 }, () =>
                    scripted(
                        () => Promise.resolve(fauxAssistantMessage("done")),
                        (said) =>
                            said === "first"
                                ? call("agent_spawn", {
                                      agent: "counter",
                                      name: "Alpha",
                                      task: "a",
                                  })
                                : said === "second"
                                  ? call("agent_spawn", { agent: "checker", task: "b" })
                                  : fauxAssistantMessage("ok"),
                    ),
                ),
            );

            for (const text of ["first", "second"]) {
                await (
                    await parent.submit({ type: "input", content: text }, context)
                ).wait(context);
                await reportersDone();
                await parent.waitForIdle(context);
            }

            const children = [...titles.keys()]
                .filter((id) => id !== parent.id)
                .toSorted((a, b) => a - b);

            assert.equal(children.length, 2);
            wiring.reads = 0;

            const named = async (session: number) =>
                agentsRef.parse(
                    await actions(host)["agents"]?.({
                        args: undefined,
                        session: { id: session, cwd: dir },
                    }),
                );

            assert.deepEqual(await named(parent.id), [
                { session: children[0], name: "Alpha", profile: "counter" },
                { session: children[1], name: "Checker", profile: "checker" },
            ]);
            assert.equal(wiring.reads, 1, "one read of the parent's record serves all its agents");

            assert.deepEqual(await named(children[0] ?? 0), [], "an agent started none");
            assert.deepEqual(
                await named(parent.id + 1000),
                [],
                "a session that is not a conversation",
            );

            const none = await harness.createConversation(
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

            assert.deepEqual(await named(none.id), [], "a parent that started no agent");
            assert.deepEqual(
                await actions(host)["agents"]?.({ args: undefined, session: null }),
                [],
            );
        });

        void it("is empty for a session with no agents and for none at all", async () => {
            await observe(parent);

            assert.deepEqual(await strip(parent.id), { parent: null, agents: [] });
            assert.deepEqual(await strip(null), { parent: null, agents: [] });
        });
    });
});

void describe("agent tool parameters", () => {
    void it("hand the model these schemas: agent_spawn closed, the others open", () => {
        assert.deepEqual(schemasSent(subagents(testHost({ name: "subagents" }))), {
            agent_spawn: {
                type: "object",
                required: ["agent", "task"],
                properties: {
                    agent: {
                        type: "string",
                        description: "Profile name, from the Agents section of the prompt.",
                    },
                    task: { type: "string", description: "Self-contained task for the new agent." },
                    name: {
                        type: "string",
                        description:
                            "Name to address it by later; defaults to the title-cased profile name.",
                    },
                    cwd: {
                        type: "string",
                        description:
                            "Absolute folder the new agent's tools work in, e.g. a git worktree path; omit to inherit this conversation's folder.",
                    },
                },
                additionalProperties: false,
            },
            agent_send: {
                type: "object",
                required: ["name", "message"],
                properties: {
                    name: { type: "string", description: "Exact name of the agent." },
                    message: { type: "string", description: "What to send." },
                },
            },
            agent_stop: {
                type: "object",
                required: ["name"],
                properties: {
                    name: { type: "string", description: "Exact name of the agent." },
                },
            },
            agent_status: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Exact name of one agent; omit to list them all.",
                    },
                },
            },
        });
    });
});
