/**
 * The list is rebuilt after a change in any session, and a run ending writes several changes at once. Reading every
 * row for each of them costs a turn on the harness's line per row, so a change that names its session now costs
 * one row. This counts the turns: the number is the whole point, so a flush that reads the list again has to show.
 */

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

import { SessionList } from "../server/session-list.ts";
import { Sessions } from "../server/sessions.ts";

/** Sessions whose list is too big for a rename to be allowed to read all of them. */
const SESSIONS = 40;

/** A session id as the harness brands it: the brand lives only in the type, as it does for `main.ts`. */
function idOf(session: number): ConversationId {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return session as ConversationId;
}

/**
 * The harness runs one commit or read at a time, so every call is one turn on that line: this is what a flush
 * costs, counted.
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

type Bench = {
    sessions: Sessions;
    list: SessionList;
    ids: number[];
    calls: string[];
    /** What the next flush costs, in turns on the harness's line. */
    turns: () => number;
    done: () => Promise<void>;
};

/** A real harness, a real list, and a counter between them. */
async function bench(): Promise<Bench> {
    const dir = await mkdtemp(join(tmpdir(), "sessions-list-rows-"));
    const model = { provider: "p", modelId: "m" };
    const models = await ModelRuntime.create();
    const harness = await Harness.open(
        await openNodeSqliteStorage(join(dir, "state.sqlite")),
        { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
        BACKGROUND_CONTEXT,
    );
    const calls: string[] = [];
    const sessions = new Sessions({
        harness: counted(harness, calls),
        model,
        models,
        context: BACKGROUND_CONTEXT,
    });
    const ids: number[] = [];

    for (let count = 0; count < SESSIONS; count += 1) {
        ids.push(Number((await sessions.create(dir)).id));
    }

    await harness.commit(async (tx) => {
        for (const id of ids) {
            await tx.appendEntry(idOf(id), {
                kind: "pi.user",
                data: { text: "name me after this question" },
            });
        }
    }, BACKGROUND_CONTEXT);

    const list = new SessionList({
        rows: () => sessions.list(() => false),
        row: async (id) => await sessions.row(idOf(id), false),
    });

    return {
        sessions,
        list,
        ids,
        calls,
        turns: () => {
            const turns = calls.filter((call) => call === "commit").length;

            calls.length = 0;

            return turns;
        },
        done: async () => {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        },
    };
}

function idAt(ids: number[], at: number): number {
    const id = ids[at];

    assert.ok(id !== undefined, `session ${String(at)} was created`);

    return id;
}

void describe("SessionList", () => {
    void it("reads one row for a change that names its session, and every row for one that does not", async () => {
        const { sessions, list, ids, turns, done } = await bench();

        try {
            assert.equal((await list.whole()).length, SESSIONS);
            await sessions.setTitle(idOf(idAt(ids, 3)), "renamed");

            turns();
            list.changed(idAt(ids, 3));

            const named = await list.flush();

            assert.deepEqual(
                named?.rows.map((row) => [row.id, row.title]),
                [[idAt(ids, 3), "renamed"]],
                "one row, named",
            );
            assert.deepEqual(named?.gone, []);

            const rowTurns = turns();

            assert.ok(
                rowTurns <= 2,
                `a named change took ${String(rowTurns)} turns on the line, where the whole list is ${String(SESSIONS)}`,
            );

            await sessions.setTitle(idOf(idAt(ids, 4)), "unnamed change");
            turns();
            list.changed();

            const whole = await list.flush();

            assert.deepEqual(
                whole?.rows.map((row) => row.id),
                [idAt(ids, 4)],
                "the whole list is read, and still only the row that differs is sent",
            );

            const wholeTurns = turns();

            assert.ok(
                wholeTurns > SESSIONS / 2,
                `the whole list took ${String(wholeTurns)} turns, so ${String(rowTurns)} for one row is the saving`,
            );
        } finally {
            await done();
        }
    });

    void it("sends a change to another session as its own row", async () => {
        const { sessions, list, ids, done } = await bench();

        try {
            await list.whole();
            await sessions.setTitle(idOf(idAt(ids, 1)), "one");
            list.changed(idAt(ids, 1));

            assert.deepEqual(
                (await list.flush())?.rows.map((row) => row.title),
                ["one"],
            );

            await sessions.setTitle(idOf(idAt(ids, 2)), "two");
            list.changed(idAt(ids, 2));

            assert.deepEqual(
                (await list.flush())?.rows.map((row) => row.title),
                ["two"],
                "the next change carries its own row and nothing from the last frame",
            );
        } finally {
            await done();
        }
    });

    void it("sends nothing for a flush with no change, or one whose row did not move", async () => {
        const { sessions, list, ids, done } = await bench();

        try {
            await list.whole();

            assert.equal(await list.flush(), undefined, "nothing was marked");

            list.changed(idAt(ids, 1));

            assert.equal(
                await list.flush(),
                undefined,
                "a row read again and unchanged is not sent",
            );

            list.changed(idAt(ids, 1));
            await sessions.setArchived(idOf(idAt(ids, 1)), true);

            assert.deepEqual(
                (await list.flush())?.rows.map((row) => row.archived),
                [true],
                "the same session again, now that it moved",
            );
        } finally {
            await done();
        }
    });

    void it("finds a change nobody named when the whole list is read again", async () => {
        const { sessions, list, ids, done } = await bench();

        try {
            await list.whole();
            // What the periodic reconcile exists for: a row that changed, with no frame naming it.
            await sessions.setTitle(idOf(idAt(ids, 5)), "unmarked one");
            await sessions.setArchived(idOf(idAt(ids, 6)), true);

            assert.equal(
                await list.flush(),
                undefined,
                "nothing is sent before the reconcile runs",
            );

            list.changed();

            const reconciled = await list.flush();

            assert.deepEqual(
                reconciled?.rows.map((row) => row.id).sort((left, right) => left - right),
                [idAt(ids, 5), idAt(ids, 6)].sort((left, right) => left - right),
                "every row that differed, and no other",
            );
            assert.equal(reconciled?.rows[0]?.title, "unmarked one");
        } finally {
            await done();
        }
    });

    void it("says a deleted session is gone, once", async () => {
        const { sessions, list, ids, done } = await bench();

        try {
            await list.whole();
            await sessions.delete(idOf(idAt(ids, 7)));
            list.changed(idAt(ids, 7));

            const frame = await list.flush();

            assert.deepEqual(frame?.gone, [idAt(ids, 7)]);
            assert.deepEqual(frame?.rows, []);

            list.changed(idAt(ids, 7));

            assert.equal(
                await list.flush(),
                undefined,
                "a client that dropped it is not told twice",
            );
        } finally {
            await done();
        }
    });
});
