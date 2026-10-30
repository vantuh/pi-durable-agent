import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type ConversationId, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

/**
 * The harness runs one commit or read at a time, so every call is one turn on that line; the list is rebuilt
 * after every change in any session, so a turn per row and not a handful per row is what keeps it cheap.
 */
function counted(harness: Harness, calls: string[]): Harness {
    return new Proxy(harness, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property, target);

            if (typeof value !== "function" || typeof property !== "string") {
                return value;
            }

            return (...args: unknown[]): unknown => {
                calls.push(property);

                return Reflect.apply(value, target, args);
            };
        },
    });
}

void describe("Sessions.list cost", () => {
    void it("reads a row in one turn on the line, however many sessions there are", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-list-cost-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });

        try {
            const ids: ConversationId[] = [];

            for (let count = 0; count < 120; count += 1) {
                ids.push((await sessions.create(dir)).id);
            }

            await harness.commit(async (tx) => {
                for (const id of ids) {
                    await tx.appendEntry(id, {
                        kind: "pi.user",
                        data: { text: "name me after this question" },
                    });
                }
            }, BACKGROUND_CONTEXT);

            const calls: string[] = [];
            const measured = new Sessions({
                harness: counted(harness, calls),
                model,
                models,
                context: BACKGROUND_CONTEXT,
            });
            const rows = await measured.list(() => false);

            assert.equal(rows.length, 120);
            assert.equal(rows[0]?.title, "name me after this question");
            assert.ok(
                calls.length <= rows.length + 20,
                `one list() of ${String(rows.length)} rows took ${String(calls.length)} turns on the line, ` +
                    `calling ${[...new Set(calls)].join(", ")}`,
            );
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
