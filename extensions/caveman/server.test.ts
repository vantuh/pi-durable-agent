import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Extension, PromptInput, PromptSection } from "@earendil-works/pi-durable";

import { ActionError, type CommitListener, type Host } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import caveman, { actions } from "./server.ts";

const context = BACKGROUND_CONTEXT;
const BODY = "FIXTURE: terse reply, every fact kept.";
const SKILL_FILE = `---
name: caveman
description: The fixture the test finds instead of the installed skill.
---

# caveman

${BODY}
`;

type Wiring = {
    listeners: CommitListener[];
    disposers: (() => void | Promise<void>)[];
    /** What the conversation records say, for the sessions no commit has published. */
    owners: Map<number, number>;
    /** Every id `sessionOwner` was asked about, in order. */
    asked: number[];
};

/** Every member the host has, as `server/extensions.ts` hands it over; only `cwd`, `dataDir`, commits and owners are read. */
function hostOf(dir: string, wiring: Wiring): Host {
    return testHost({
        name: "caveman",
        cwd: dir,
        dataDir: dir,
        onCommit: (listener) => {
            wiring.listeners.push(listener);
        },
        onDispose: (dispose) => {
            wiring.disposers.push(dispose);
        },
        sessionOwner: (session) => {
            wiring.asked.push(session);

            return Promise.resolve(wiring.owners.get(session));
        },
    });
}

/** Only the two fields the section reads are filled in. */
function input(conversation: number, cwd: string): PromptInput {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a real request carries more than a section reads
    return { conversationId: conversation, agent: { cwd } } as unknown as PromptInput;
}

function renderOf(extension: Extension): PromptSection["render"] {
    const first = extension.sections?.[0];

    assert.ok(first !== undefined, "the extension installs no section");

    return async (request, scope) => await first.render(request, scope);
}

void describe("caveman", () => {
    let dir: string;
    let previousAgentDir: string | undefined;
    let previousHome: string | undefined;
    let wiring: Wiring;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "caveman-"));
        // The real skill lives in the user's agent folder: point it at a folder with none, so the fixture wins.
        previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
        previousHome = process.env["HOME"];
        process.env["PI_CODING_AGENT_DIR"] = join(dir, "agent");
        await mkdir(join(dir, ".agents", "skills", "caveman"), { recursive: true });
        await writeFile(join(dir, ".agents", "skills", "caveman", "SKILL.md"), SKILL_FILE);
        wiring = { listeners: [], disposers: [], owners: new Map(), asked: [] };
    });

    afterEach(async () => {
        if (previousAgentDir === undefined) {
            delete process.env["PI_CODING_AGENT_DIR"];
        } else {
            process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
        }

        if (previousHome === undefined) {
            delete process.env["HOME"];
        } else {
            process.env["HOME"] = previousHome;
        }

        await rm(dir, { recursive: true, force: true });
    });

    void it("gives a person's conversation the skill's body and why it is on", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });

        const text = await render(input(1, dir), context);

        assert.ok(text !== undefined, "the extension added no section");
        assert.ok(text.includes(BODY), `no skill body in: ${text}`);
        assert.ok(
            text.includes("CAVEMAN MODE ON — switched from this app's status bar, not by chat."),
        );
        assert.ok(!text.includes("description: The fixture the test finds"));
    });

    void it("adds no section while the switch is off", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        assert.deepEqual(await actions(host)["state"]?.({ args: undefined, session: null }), {
            on: false,
        });
        assert.equal(await render(input(1, dir), context), undefined);
    });

    void it("adds no section to a conversation another one started", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });
        for (const listener of wiring.listeners) {
            await listener({
                session: { id: 3, cwd: dir, owner: 2 },
                entries: [],
                busy: false,
            });
        }

        assert.equal(await render(input(3, dir), context), undefined);
        // A published owner needs no record read.
        assert.deepEqual(wiring.asked, []);

        // A conversation no commit has named yet is a person's: no map entry must not switch it off.
        assert.ok((await render(input(4, dir), context))?.includes(BODY));
        assert.deepEqual(wiring.asked, [4]);
    });

    void it("adds no section when only the conversation record holds the owner", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });
        // A subagent's first request is built before its baseline view arrives: no commit names it yet.
        wiring.owners.set(5, 2);

        assert.equal(await render(input(5, dir), context), undefined);
        assert.deepEqual(wiring.asked, [5]);
    });

    void it("gives the section to a conversation the record says a person started", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });

        assert.ok((await render(input(6, dir), context))?.includes(BODY));
        assert.deepEqual(wiring.asked, [6]);
    });

    void it("asks the record once per conversation", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });

        assert.ok((await render(input(7, dir), context))?.includes(BODY));
        assert.ok((await render(input(7, dir), context))?.includes(BODY));
        assert.deepEqual(wiring.asked, [7]);
    });

    void it("keeps the switch in the data folder and refuses anything but { on: boolean }", async () => {
        const host = hostOf(dir, wiring);

        await caveman(host);
        assert.deepEqual(await actions(host)["set"]?.({ args: { on: true }, session: null }), {
            on: true,
        });
        await assert.rejects(
            async () => await actions(host)["set"]?.({ args: { on: "yes" }, session: null }),
            ActionError,
        );

        // A second load reads the file the first one wrote.
        const render = renderOf(await caveman(host));

        assert.ok((await render(input(1, dir), context))?.includes(BODY));
    });

    void it("keeps the mode it had when the save fails", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await caveman(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });
        // A folder where the state file goes: the write cannot land.
        await rm(join(dir, "caveman.json"));
        await mkdir(join(dir, "caveman.json"));

        await assert.rejects(
            async () => await actions(host)["set"]?.({ args: { on: false }, session: null }),
        );
        assert.deepEqual(await actions(host)["state"]?.({ args: undefined, session: null }), {
            on: true,
        });
        assert.ok((await render(input(1, dir), context))?.includes(BODY));
    });

    void it("is off when the state file is missing or broken", async () => {
        const host = hostOf(dir, wiring);

        await writeFile(join(dir, "caveman.json"), "{ not json");
        await caveman(host);
        assert.deepEqual(await actions(host)["state"]?.({ args: undefined, session: null }), {
            on: false,
        });

        await writeFile(join(dir, "caveman.json"), '{ "on": "yes" }');
        const render = renderOf(await caveman(host));

        assert.equal(await render(input(1, dir), context), undefined);
    });

    void it("refuses to load when the skill is not installed", async () => {
        // No copy anywhere: no fixture in the folder, and a home folder with no skills of its own.
        await rm(join(dir, ".agents", "skills", "caveman"), { recursive: true, force: true });
        await mkdir(join(dir, "home"), { recursive: true });
        process.env["HOME"] = join(dir, "home");

        await assert.rejects(caveman(hostOf(dir, wiring)), /"caveman" skill is not installed/);
    });
});
