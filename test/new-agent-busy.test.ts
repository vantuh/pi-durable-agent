import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { SessionSummary, SessionListEvent } from "../shared/protocol.ts";
import { withSessionsEvent } from "../web/src/lib/session-list.ts";
import { cleanUp, linkExtension, REPO, sandbox, startServer } from "./fixtures/server.ts";

/** A real server in a temporary folder with the subagents extension and a faux model, nothing else. */
async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const box = await sandbox("new-agent-busy");

    await linkExtension(box, "subagents", {
        "server.ts": join(REPO, "extensions", "subagents", "server.ts"),
        "profiles.ts": join(REPO, "extensions", "subagents", "profiles.ts"),
        "refs.ts": join(REPO, "extensions", "subagents", "refs.ts"),
    });
    await linkExtension(box, "fauxmodel", {
        "server.ts": join(REPO, "test", "fixtures", "faux-agent-model.ts"),
    });
    await mkdir(join(box.cwd, ".pi", "agents"), { recursive: true });
    await writeFile(
        join(box.cwd, ".pi", "agents", "counter.md"),
        "---\nname: counter\ndescription: Counts files.\ntools: read\nmodel: fx/m1\nthinking: low\n---\nCount.\n",
    );

    const { base, output, cwd } = await startServer({ box, env: { MODEL: "fx/m1" } });

    return { base, output, cwd };
}

async function post(base: string, path: string, body: unknown): Promise<unknown> {
    const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    assert.equal(response.ok, true, `${path}: ${String(response.status)}`);

    return await response.json();
}

/** One entry per frame, folded into the list the screen holds; the count is the frames that arrived. */
function watchList(base: string): { lists: SessionSummary[][]; stop: () => void } {
    const lists: SessionSummary[][] = [];
    const abort = new AbortController();
    let held: SessionSummary[] = [];

    void (async () => {
        const response = await fetch(`${base}/api/sessions/events`, { signal: abort.signal });
        const decoder = new TextDecoder();
        let pending = "";

        for await (const chunk of response.body ?? []) {
            pending += decoder.decode(chunk, { stream: true });

            const frames = pending.split("\n\n");

            pending = frames.pop() ?? "";

            for (const frame of frames) {
                if (frame.startsWith("data: ")) {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server writes the list's JSON
                    held = withSessionsEvent(held, JSON.parse(frame.slice(6)) as SessionListEvent);
                    lists.push(held);
                }
            }
        }
    })().catch(() => undefined);

    return { lists, stop: () => abort.abort() };
}

after(cleanUp);

void describe("an agent started after the server did", () => {
    void it("shows as working in the session list and for extensions, without anyone opening it", async () => {
        const { base, output, cwd } = await sandboxServer();
        const created = await post(base, "/api/sessions", { cwd });
        const parent =
            typeof created === "object" && created !== null
                ? Number(Reflect.get(created, "session"))
                : 0;
        const watch = watchList(base);
        const childRow = (list: SessionSummary[]): SessionSummary | undefined =>
            list.find((row) => row.parent === parent);
        /** The names in the strip of the parent: the agents the extension saw working. */
        const working = async (): Promise<unknown[]> => {
            const answer = await post(base, "/api/extensions/subagents/actions/strip", {
                session: parent,
            });
            const result =
                typeof answer === "object" && answer !== null
                    ? Reflect.get(answer, "result")
                    : null;
            const agents =
                typeof result === "object" && result !== null ? Reflect.get(result, "agents") : [];

            return Array.isArray(agents)
                ? agents.map((agent: unknown) => Reflect.get(Object(agent), "name"))
                : [];
        };

        try {
            await delay(300);
            await post(base, "/api/messages", { session: parent, text: "spawn Alpha" });

            const until = async (done: () => boolean | Promise<boolean>): Promise<void> => {
                for (let attempt = 0; attempt < 80; attempt++) {
                    if (await done()) {
                        return;
                    }

                    await delay(100);
                }

                assert.fail(`timed out\n${output()}`);
            };

            await until(() => watch.lists.some((list) => childRow(list)?.busy === true));
            assert.deepEqual(await working(), ["Alpha"], "the extension saw the agent work");

            await until(() => {
                const last = watch.lists.at(-1);

                return last !== undefined && childRow(last)?.busy === false;
            });
            assert.deepEqual(await working(), [], "and saw it stop");
        } finally {
            watch.stop();
        }
    });
});
