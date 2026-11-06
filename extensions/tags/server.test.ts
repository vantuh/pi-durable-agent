// Test: making a tag, putting it on sessions, and what dropping it leaves behind.
// Run: pnpm test

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Host } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { FALLBACK_COLOR, MAX_NAME, state as stateRef, type TagsState } from "./refs.ts";
import { tagActions } from "./server.ts";
import { readTags } from "./server/store.ts";

function hostOf(dataDir: string): Host {
    return testHost({
        name: "tags",
        cwd: dataDir,
        dataDir,
    });
}

/** The answer as the browser reads it: through the ref's own check, which is the contract. */
const asState = (value: unknown): TagsState => stateRef.parse(value);

const call = (args: unknown, session: number | null = null) => ({
    args,
    session: session === null ? null : { id: session, cwd: null },
});

async function withDir(work: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "tags-test-"));

    try {
        await work(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

void test("makes a tag, tidies its name and keeps it in the file", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const made = asState(await run.create(call({ name: "  Deep   work ", color: "pink" })));

        assert.deepEqual(
            made.tags.map((tag) => tag.name),
            ["Deep work"],
        );
        assert.deepEqual(
            (await readTags(dir)).tags.map((tag) => tag.name),
            ["Deep work"],
        );
    });
});

void test("refuses a name that is empty, too long or already taken", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));

        await run.create(call({ name: "Deep work", color: "mauve" }));

        await assert.rejects(run.create(call({ name: "   ", color: "mauve" })), /needs a name/u);
        await assert.rejects(
            run.create(call({ name: "deep WORK", color: "mauve" })),
            /already a tag/u,
        );
        await assert.rejects(
            run.create(call({ name: "я".repeat(MAX_NAME + 1), color: "mauve" })),
            /at most/u,
        );
        await assert.rejects(
            run.create(call({ id: "nope", color: "mauve" })),
            /args must be \{ name: string \}/u,
        );
        await assert.rejects(
            run.create(call({ name: "Uncoloured", color: "octarine" })),
            /args must be \{ color: one of/u,
        );
    });
});

void test("puts a tag on a session and takes it off again", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const tag = asState(await run.create(call({ name: "Deep work", color: "mauve" }))).tags[0];
        assert.ok(tag);

        const on = asState(await run.toggle(call({ tag: tag.id }, 7)));
        assert.deepEqual(on.sessions["7"], [tag.id]);

        const off = asState(await run.toggle(call({ tag: tag.id }, 7)));
        assert.equal(off.sessions["7"], undefined);

        assert.equal((await readTags(dir)).sessions["7"], undefined);
        assert.deepEqual((await readTags(dir)).tags, [
            { id: tag.id, name: "Deep work", color: "mauve" },
        ]);
    });
});

void test("a dropped tag leaves every session it was on", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const kept = asState(await run.create(call({ name: "Kept", color: "green" }))).tags[0];
        const dropped = asState(await run.create(call({ name: "Dropped", color: "red" }))).tags[1];
        assert.ok(kept);
        assert.ok(dropped);

        await run.toggle(call({ tag: kept.id }, 1));
        await run.toggle(call({ tag: dropped.id }, 1));
        await run.toggle(call({ tag: dropped.id }, 2));

        const after = asState(await run.remove(call({ id: dropped.id })));

        assert.deepEqual(
            after.tags.map((tag) => tag.name),
            ["Kept"],
        );
        assert.deepEqual(after.sessions, { "1": [kept.id] });
        assert.deepEqual((await readTags(dir)).sessions, { "1": [kept.id] });
    });
});

void test("changes that arrive together all land", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));

        await Promise.all([
            run.create(call({ name: "One", color: "blue" })),
            run.create(call({ name: "Two", color: "teal" })),
        ]);

        const made = await readTags(dir);
        assert.deepEqual(
            made.tags.map((tag) => tag.name),
            ["One", "Two"],
        );

        const [one, two] = made.tags;
        assert.ok(one);
        assert.ok(two);

        await Promise.all([
            run.toggle(call({ tag: one.id }, 7)),
            run.toggle(call({ tag: two.id }, 7)),
        ]);

        assert.deepEqual((await readTags(dir)).sessions["7"], [one.id, two.id]);
    });
});

void test("another name keeps the tag on its sessions, and its colour", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const tag = asState(await run.create(call({ name: "Deep work", color: "peach" }))).tags[0];
        assert.ok(tag);

        await run.toggle(call({ tag: tag.id }, 7));

        const renamed = asState(await run.rename(call({ id: tag.id, name: "  Focus  work " })));

        assert.deepEqual(renamed.tags, [{ id: tag.id, name: "Focus work", color: "peach" }]);
        assert.deepEqual(renamed.sessions, { "7": [tag.id] });
        assert.deepEqual((await readTags(dir)).tags, [
            { id: tag.id, name: "Focus work", color: "peach" },
        ]);
    });
});

void test("a rename refuses another tag's name, an empty one, and an unknown tag", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const deep = asState(await run.create(call({ name: "Deep work", color: "mauve" }))).tags[0];
        assert.ok(deep);

        await run.create(call({ name: "Client", color: "blue" }));

        await assert.rejects(run.rename(call({ id: deep.id, name: "client" })), /already a tag/u);
        await assert.rejects(run.rename(call({ id: deep.id, name: "  " })), /needs a name/u);
        await assert.rejects(run.rename(call({ id: "gone", name: "Other" })), /no such tag/u);

        // Its own name in another case is not a clash with itself.
        const same = asState(await run.rename(call({ id: deep.id, name: "DEEP work" })));

        assert.equal(same.tags[0]?.name, "DEEP work");
    });
});

void test("another colour leaves the sessions the tag is on alone", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));
        const tag = asState(await run.create(call({ name: "Deep work", color: "mauve" }))).tags[0];
        assert.ok(tag);

        await run.toggle(call({ tag: tag.id }, 7));

        const recoloured = asState(await run.recolor(call({ id: tag.id, color: "peach" })));

        assert.deepEqual(recoloured.tags, [{ id: tag.id, name: "Deep work", color: "peach" }]);
        assert.deepEqual(recoloured.sessions, { "7": [tag.id] });

        await assert.rejects(
            run.recolor(call({ id: tag.id, color: "octarine" })),
            /args must be \{ color: one of/u,
        );
        await assert.rejects(run.recolor(call({ id: "gone", color: "peach" })), /no such tag/u);
    });
});

void test("refuses a tag that is not there, and a toggle without a session", async () => {
    await withDir(async (dir) => {
        const run = tagActions(hostOf(dir));

        await assert.rejects(run.remove(call({ id: "gone" })), /no such tag/u);
        await assert.rejects(run.toggle(call({ tag: "gone" }, 4)), /no such tag/u);
        await assert.rejects(run.toggle(call({ tag: "gone" })), /a session is needed/u);
    });
});

void test("a file naming tags that are gone, or holding junk, reads as what it does have", async () => {
    await withDir(async (dir) => {
        await writeFile(
            join(dir, "tags.json"),
            JSON.stringify({
                tags: [
                    { id: "a", name: "Kept", color: "green" },
                    { id: 5, name: "broken" },
                    { id: "b", name: "   " },
                    { id: "", name: "nameless" },
                    { id: "c", name: "Old", color: "octarine" },
                    { id: "d", name: "Older" },
                ],
                sessions: {
                    "3": ["a", "vanished", 7],
                    nope: ["a"],
                    "4": ["vanished"],
                    "5": ["b"],
                },
            }),
        );

        assert.deepEqual(await readTags(dir), {
            tags: [
                { id: "a", name: "Kept", color: "green" },
                { id: "c", name: "Old", color: FALLBACK_COLOR },
                { id: "d", name: "Older", color: FALLBACK_COLOR },
            ],
            sessions: { "3": ["a"] },
        });

        await writeFile(join(dir, "tags.json"), "{oops");

        assert.deepEqual(await readTags(dir), { tags: [], sessions: {} });
        assert.deepEqual(asState(await tagActions(hostOf(dir)).state()), {
            tags: [],
            sessions: {},
        });
    });
});
