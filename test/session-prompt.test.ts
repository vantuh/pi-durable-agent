/**
 * The prompt an empty session's first request will carry, read before it is sent: the same sections and
 * tools the generation's `prepare` phase commits, so the context meter can show it. The preview must
 * write no entry, call no model, and match a real first run exactly; once the session has entries it
 * answers nothing, since the prompt is no longer the whole context.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
    type Conversation,
    createRegistry,
    defineTool,
    Harness,
    MemoryStorage,
    section,
    SystemEntry,
    wrapSection,
} from "@earendil-works/pi-durable";

import { sessionPromptOf } from "../server/session-prompt.ts";

const NOTES = "keep the notes short";

type Target = { conversationId: number; cwd?: string; read: unknown };

type Made = {
    harness: Harness;
    models: ReturnType<typeof createModels>;
    conversation: Conversation;
    /** Everything the prompt renderer reported: a section or the environment that failed. */
    reported: string[];
    /** Makes the notes section throw, as a broken extension would. */
    break: () => void;
    /** Every environment target the builder was given, the preview's and the request's. */
    targets: Target[];
    /** How many requests the provider was asked for. */
    calls: () => number;
    close: () => Promise<void>;
};

async function made(options: { withModel?: boolean; wrap?: boolean } = {}): Promise<Made> {
    const models = createModels();
    const faux = fauxProvider({ models: [{ id: "m1", contextWindow: 4000 }] });
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("an answer")]);

    let broken = false;
    const registry = createRegistry();

    registry.install({
        name: "probe",
        sections: [
            section("rules", (input) => `Project folder: ${input.agent.cwd ?? ""}`, { tag: false }),
            section("notes", () => {
                if (broken) {
                    throw new Error("no notes");
                }

                return NOTES;
            }),
            section("absent", () => undefined),
        ],
        tools: [
            defineTool({
                name: "probe",
                description: "does nothing",
                parameters: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    required: ["value"],
                },
                execute: () => Promise.resolve({ output: [{ type: "text", text: "done" }] }),
            }),
            defineTool({
                name: "loaded_later",
                description: "offered only once loaded",
                parameters: { type: "object", properties: {} },
                deferred: true,
                execute: () => Promise.resolve({ output: [{ type: "text", text: "done" }] }),
            }),
        ],
    });

    if (options.wrap === true) {
        registry.install({
            name: "wrap",
            wraps: [
                wrapSection("notes", (each) => ({
                    ...each,
                    render: async (input, where) =>
                        `wrapped: ${(await each.render(input, where)) ?? ""}`,
                })),
            ],
        });
    }

    const targets: Target[] = [];
    const env = (target: Target): undefined => {
        targets.push(target);

        return undefined;
    };
    const harness = await Harness.open(new MemoryStorage(), { models, registry, env }, context);
    const conversation = await harness.createConversation(
        {
            ownership: { kind: "ownerless" },
            agent: {
                ...(options.withModel === false
                    ? {}
                    : { model: { provider: faux.provider.id, modelId: faux.getModel().id } }),
                cwd: "/work",
            },
        },
        context,
    );

    return {
        harness,
        models,
        conversation,
        reported: [],
        targets,
        break: () => {
            broken = true;
        },
        calls: () => faux.state.callCount,
        close: async () => {
            await harness.close(context);
        },
    };
}

/** The prompt as the app reads it, with a report collector of this test's own. */
async function previewOf(test: Made) {
    return await sessionPromptOf({
        conversation: test.conversation,
        models: test.models,
        env: (target) => {
            test.targets.push(target);

            return undefined;
        },
        read: test.harness,
        report: (_error, what) => {
            test.reported.push(what);
        },
        context,
    });
}

/** The system message the first request committed, which is the prompt it sent. */
async function committedPrompt(test: Made) {
    const { entries } = await test.conversation.context(context);
    const entry = entries.find((each) => SystemEntry.is(each));
    const message = (entry?.model ?? []).find((each) => each.role === "system");

    assert.ok(message?.role === "system", "the run committed a system message");

    return message;
}

/** Sends one question and lets the run finish. */
async function asked(test: Made): Promise<void> {
    const submission = await test.conversation.submit({ type: "input", content: "hello" }, context);

    await submission.wait(context);
    await test.harness.waitForIdle(context);
}

void describe("the prompt an empty session's first request would carry", () => {
    void it("matches the prompt a first run commits, and writes and sends nothing before it", async () => {
        const test = await made();

        try {
            const preview = await previewOf(test);

            assert.ok(preview);
            assert.equal(test.calls(), 0, "reading the prompt is not a request");
            assert.equal((await test.conversation.context(context)).entries.length, 0);
            assert.equal(test.targets.length, 1);
            assert.equal(test.targets[0]?.conversationId, Number(test.conversation.id));
            assert.equal(test.targets[0]?.cwd, "/work");
            // Sections read documents the way a request does.
            assert.equal(test.targets[0]?.read, test.harness);

            await asked(test);

            // The run built the environment for its request from the same target, so the sections saw
            // the same environment there as here.
            assert.equal(test.targets.length, 2);
            assert.equal(test.targets[1]?.conversationId, test.targets[0]?.conversationId);
            assert.equal(test.targets[1]?.cwd, test.targets[0]?.cwd);
            assert.equal(test.targets[1]?.read, test.targets[0]?.read);

            const message = await committedPrompt(test);

            assert.deepEqual(
                Object.entries(message.sections ?? {}),
                preview.sections.map(({ key, text }) => [key, text]),
            );
            assert.deepEqual(message.toolsAdded, preview.tools);
            // A deferred tool is not offered, so it is not in the preview's prompt either.
            assert.deepEqual(
                preview.tools.map((tool) => tool.name),
                ["probe"],
            );
            // The context now holds a question and an answer: the prompt is no longer all of it.
            assert.equal(await previewOf(test), undefined);
        } finally {
            await test.close();
        }
    });

    void it("leaves out an empty section, keeps an untagged one untagged, and drops a broken one", async () => {
        const test = await made();

        try {
            assert.deepEqual((await previewOf(test))?.sections, [
                { key: "rules", text: "Project folder: /work" },
                { key: "notes", text: `<notes>\n${NOTES}\n</notes>` },
            ]);

            // Nothing is sent: a section that throws before the first request is reported and left out.
            test.break();

            assert.deepEqual(
                (await previewOf(test))?.sections.map(({ key }) => key),
                ["rules"],
            );
            assert.deepEqual(test.reported, ["notes"]);

            await asked(test);

            assert.deepEqual(Object.keys((await committedPrompt(test)).sections ?? {}), ["rules"]);
        } finally {
            await test.close();
        }
    });

    void it("sends a wrapped section as the wrapper leaves it", async () => {
        const test = await made({ wrap: true });

        try {
            const preview = await previewOf(test);

            assert.deepEqual(preview?.sections, [
                { key: "rules", text: "Project folder: /work" },
                { key: "notes", text: `<notes>\nwrapped: ${NOTES}\n</notes>` },
            ]);

            await asked(test);

            assert.deepEqual(
                Object.entries((await committedPrompt(test)).sections ?? {}),
                preview?.sections.map(({ key, text }) => [key, text]),
            );
        } finally {
            await test.close();
        }
    });

    void it("is undefined for a conversation with no model chosen", async () => {
        const test = await made({ withModel: false });

        try {
            assert.equal(await previewOf(test), undefined);
        } finally {
            await test.close();
        }
    });

    void it("renders without an environment when its builder throws", async () => {
        const test = await made();

        try {
            const preview = await sessionPromptOf({
                conversation: test.conversation,
                models: test.models,
                env: () => {
                    throw new Error("no environment");
                },
                read: test.harness,
                report: (_error, what) => {
                    test.reported.push(what);
                },
                context,
            });

            assert.ok(preview);
            assert.deepEqual(
                preview.sections.map(({ key }) => key),
                ["rules", "notes"],
            );
            assert.deepEqual(test.reported, ["env"]);
        } finally {
            await test.close();
        }
    });
});
