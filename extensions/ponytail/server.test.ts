import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Extension, PromptInput, PromptSection } from "@earendil-works/pi-durable";

import { ActionError, type CommitListener, type Host } from "../../server/sdk.ts";
import ponytail, { actions } from "./server.ts";

const context = BACKGROUND_CONTEXT;
const BODY = "FIXTURE: the smallest change that works.";
const SKILL_FILE = `---
name: ponytail
description: The fixture the test finds instead of the installed skill.
---

# ponytail

${BODY}
`;

type Wiring = {
    listeners: CommitListener[];
    disposers: (() => void | Promise<void>)[];
    /** What the conversation records say. Ponytail never asks, and the section must not care. */
    owners: Map<number, number>;
};

/** Every member the host has, as `server/extensions.ts` hands it over; only `cwd`, `dataDir` and owners are read. */
function hostOf(dir: string, wiring: Wiring): Host {
    return {
        name: "ponytail",
        cwd: dir,
        dataDir: dir,
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
        contextWindow: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        sessionOwner: (session) => Promise.resolve(wiring.owners.get(session)),
        sessionSeen: () => Promise.resolve(false),
        setSessionTitle: () => Promise.resolve(),
        readDoc: (doc) => Promise.resolve(doc.definition.initial()),
        setSessionMark: () => undefined,
        toolOwner: () => undefined,
        folderGroup: () => undefined,
        notifySessionChanged: () => undefined,
        notify: () => undefined,
    };
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

void describe("ponytail", () => {
    let dir: string;
    let previousAgentDir: string | undefined;
    let previousHome: string | undefined;
    let wiring: Wiring;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ponytail-"));
        // The real skill lives in the user's agent folder: point it at a folder with none, so the fixture wins.
        previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
        previousHome = process.env["HOME"];
        process.env["PI_CODING_AGENT_DIR"] = join(dir, "agent");
        await mkdir(join(dir, ".agents", "skills", "ponytail"), { recursive: true });
        await writeFile(join(dir, ".agents", "skills", "ponytail", "SKILL.md"), SKILL_FILE);
        wiring = { listeners: [], disposers: [], owners: new Map() };
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
        const render = renderOf(await ponytail(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });

        const text = await render(input(1, dir), context);

        assert.ok(text !== undefined, "the extension added no section");
        assert.ok(text.includes(BODY), `no skill body in: ${text}`);
        assert.ok(
            text.includes("PONYTAIL MODE ON — switched from this app's status bar, not by chat."),
        );
        assert.ok(!text.includes("description: The fixture the test finds"));
    });

    void it("adds no section while the switch is off", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await ponytail(host));

        assert.deepEqual(await actions(host)["state"]?.({ args: undefined, session: null }), {
            on: false,
        });
        assert.equal(await render(input(1, dir), context), undefined);
    });

    void it("adds the section to a conversation a tool started too", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await ponytail(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });
        // The record says a tool started this one: unlike caveman, ponytail answers in a subagent too.
        wiring.owners.set(3, 2);

        assert.ok((await render(input(3, dir), context))?.includes(BODY));
        assert.ok((await render(input(4, dir), context))?.includes(BODY));
        // No ownership machinery at all: the extension listens to no commit.
        assert.deepEqual(wiring.listeners, []);
    });

    void it("keeps the switch in the data folder and refuses anything but { on: boolean }", async () => {
        const host = hostOf(dir, wiring);

        await ponytail(host);
        assert.deepEqual(await actions(host)["set"]?.({ args: { on: true }, session: null }), {
            on: true,
        });
        await assert.rejects(
            async () => await actions(host)["set"]?.({ args: { on: "yes" }, session: null }),
            ActionError,
        );

        // A second load reads the file the first one wrote.
        const render = renderOf(await ponytail(host));

        assert.ok((await render(input(1, dir), context))?.includes(BODY));
    });

    void it("keeps the mode it had when the save fails", async () => {
        const host = hostOf(dir, wiring);
        const render = renderOf(await ponytail(host));

        await actions(host)["set"]?.({ args: { on: true }, session: null });
        // A folder where the state file goes: the write cannot land.
        await rm(join(dir, "ponytail.json"));
        await mkdir(join(dir, "ponytail.json"));

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

        await writeFile(join(dir, "ponytail.json"), "{ not json");
        await ponytail(host);
        assert.deepEqual(await actions(host)["state"]?.({ args: undefined, session: null }), {
            on: false,
        });

        await writeFile(join(dir, "ponytail.json"), '{ "on": "yes" }');
        const render = renderOf(await ponytail(host));

        assert.equal(await render(input(1, dir), context), undefined);
    });

    void it("refuses to load when the skill is not installed", async () => {
        // No copy anywhere: no fixture in the folder, and a home folder with no skills of its own.
        await rm(join(dir, ".agents", "skills", "ponytail"), { recursive: true, force: true });
        await mkdir(join(dir, "home"), { recursive: true });
        process.env["HOME"] = join(dir, "home");

        await assert.rejects(ponytail(hostOf(dir, wiring)), /"ponytail" skill is not installed/);
    });
});
