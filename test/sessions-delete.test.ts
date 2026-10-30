import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    type ConversationId,
    createRegistry,
    defineTask,
    Harness,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

const Anchor = defineTask<null, { phase: "done" }, null>({
    name: "test.anchor",
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

void describe("Sessions.delete", () => {
    void it("stops a running conversation, so nothing works on unseen", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-delete-busy-"));
        const faux = fauxProvider();
        const models = createModels();
        let started: () => void = () => undefined;
        const running = new Promise<void>((done) => {
            started = done;
        });
        let aborted = false;

        models.setProvider(faux.provider);
        faux.setResponses([
            (_context, options) =>
                new Promise((done) => {
                    started();
                    options?.signal?.addEventListener("abort", () => {
                        aborted = true;
                        done(fauxAssistantMessage("", { stopReason: "aborted" }));
                    });
                }),
        ]);

        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            {
                models,
                registry: createRegistry(),
                env: () => new NodeExecutionEnv({ cwd: dir }),
            },
            BACKGROUND_CONTEXT,
        );
        const model = { provider: faux.provider.id, modelId: faux.getModel().id };
        const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });

        harness.resume();

        try {
            const conversation = await sessions.create(dir);

            await conversation.submit(
                { type: "input", content: [{ type: "text", text: "work" }] },
                BACKGROUND_CONTEXT,
            );
            await running;
            await sessions.delete(conversation.id);

            assert.equal(aborted, true, "the model request was aborted");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });

    void it("keeps the transcript but hides the session from every list, also after a restart", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-delete-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const open = async (): Promise<Harness> =>
            Harness.open(
                await openNodeSqliteStorage(join(dir, "state.sqlite")),
                {
                    models,
                    registry: createRegistry(),
                    env: () => new NodeExecutionEnv({ cwd: dir }),
                },
                BACKGROUND_CONTEXT,
            );
        const sessionsOf = (harness: Harness): Sessions =>
            new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });

        const harness = await open();
        const sessions = sessionsOf(harness);
        const deleted = await sessions.create(dir);
        const kept = await sessions.create(dir);

        await harness.commit(
            (tx) => tx.appendEntry(deleted.id, { kind: "test.note", data: { text: "hi" } }),
            BACKGROUND_CONTEXT,
        );

        try {
            await sessions.delete(deleted.id);

            assert.deepEqual(
                (await sessions.list(() => false)).map((row) => row.id),
                [kept.id],
                "a deleted session is not listed",
            );
            assert.equal(await sessions.open(deleted.id), undefined, "and cannot be opened");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }

        const reopened = await open();

        try {
            const listed = await sessionsOf(reopened).list(() => false);

            assert.deepEqual(
                listed.map((row) => row.id),
                [kept.id],
                "the note survives the restart",
            );
            assert.ok(
                await reopened.conversation(deleted.id, BACKGROUND_CONTEXT),
                "the deleted conversation is still in storage",
            );
            assert.equal(
                (
                    await reopened.commit(
                        (tx) => tx.scanEntries({ conversationId: deleted.id }, 10),
                        BACKGROUND_CONTEXT,
                    )
                ).items.length,
                1,
                "and so is its transcript",
            );
        } finally {
            await reopened.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });

    void it("hides the sessions started from it, and what those started", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-delete-children-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const started = async (from: ConversationId): Promise<ConversationId> =>
            harness.commit(async (tx) => {
                const anchor = await tx.createTask(Anchor, null, {
                    ownership: { kind: "conversation" },
                    conversationId: from,
                    background: true,
                });
                const child = await tx.createConversation({
                    ownership: { kind: "task", taskId: anchor },
                });

                return child.id;
            }, BACKGROUND_CONTEXT);

        try {
            const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });
            const parent = await sessions.create(dir);
            const child = await started(parent.id);
            const grandchild = await started(child);
            const alone = await sessions.create(dir);
            const listed = async (): Promise<number[]> =>
                (await sessions.list(() => false)).map((row) => row.id);

            assert.deepEqual(
                await listed(),
                [parent.id, child, grandchild, alone.id],
                "every session is listed while the one that started it is",
            );

            await sessions.delete(parent.id);

            assert.deepEqual(
                await listed(),
                [alone.id],
                "a session started from a deleted one has no row to hang under",
            );
            assert.ok(
                await harness.conversation(child, BACKGROUND_CONTEXT),
                "and its transcript stays in storage",
            );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
