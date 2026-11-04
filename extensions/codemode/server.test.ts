/**
 * The `codemode` extension on a real server in a temporary folder, with a faux model that makes one
 * `codemode` call. The script runs `bash` as a nested call, so the answer in the transcript shows the
 * sandbox started, the tool table reached `bash`, and the script's return value came back.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, Harness, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type { Host } from "../../server/sdk.ts";
import codemode from "./server.ts";

const REPO = join(import.meta.dirname, "..", "..");
const roots: string[] = [];
const running: ChildProcess[] = [];

async function freePort(): Promise<number> {
    const probe = createNetServer();

    await new Promise<void>((done) => {
        probe.listen(0, "127.0.0.1", done);
    });

    const address = probe.address();

    assert.ok(address !== null && typeof address !== "string");
    await new Promise<void>((done) => {
        probe.close(() => {
            done();
        });
    });

    return address.port;
}

async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const root = await mkdtemp(join(tmpdir(), "codemode-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions", "fauxmodel"), { recursive: true });
    await mkdir(join(cwd, "extensions", "codemode"), { recursive: true });
    await symlink(
        join(REPO, "test", "fixtures", "faux-codemode-model.ts"),
        join(cwd, "extensions", "fauxmodel", "server.ts"),
    );
    await symlink(
        join(REPO, "extensions", "codemode", "server.ts"),
        join(cwd, "extensions", "codemode", "server.ts"),
    );

    const port = await freePort();
    const child = spawn(process.execPath, [join(REPO, "server", "main.ts")], {
        cwd,
        env: {
            PATH: process.env["PATH"] ?? "",
            HOME: root,
            PI_CODING_AGENT_DIR: join(root, "agent"),
            PI_DURABLE_DATA_DIR: join(root, "data"),
            MODEL: "fx/m1",
            PORT: String(port),
        },
    });
    let output = "";

    running.push(child);
    await new Promise<void>((done, fail) => {
        const onData = (chunk: Buffer): void => {
            output += chunk.toString();

            if (output.includes(`http://127.0.0.1:${String(port)}`)) {
                done();
            }
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", () => {
            fail(new Error(output));
        });
    });

    return { base: `http://127.0.0.1:${String(port)}`, output: () => output, cwd };
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

after(async () => {
    for (const child of running) {
        child.kill();
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("codemode extension", () => {
    void it("runs a script that calls bash and returns its value to the model", async () => {
        const { base, output, cwd } = await sandboxServer();
        const created = await post(base, "/api/sessions", { cwd });

        assert.ok(typeof created === "object" && created !== null);

        const session = Number(Reflect.get(created, "session"));

        await post(base, "/api/messages", { session, text: "run the script" });

        let history = "";

        // The script's own source says "bash said " too, so wait for the result, not the call.
        for (let attempt = 0; attempt < 100 && !history.includes("bash said 42"); attempt += 1) {
            await delay(100);
            history = await (await fetch(`${base}/api/history?session=${String(session)}`)).text();
        }

        assert.match(history, /bash said 42, exit 0/, output());
    });
});

/** Only `onDispose` reaches the extension; the rest is what the core would hand it. */
function hostOf(cwd: string): Host {
    return {
        name: "codemode",
        cwd,
        dataDir: cwd,
        log: () => undefined,
        onDispose: () => undefined,
        onCommit: () => undefined,
        folderGroup: () => undefined,
        shapeModelRequests: () => undefined,
        wrapModelFetch: () => undefined,
        registerModelProvider: () => () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        sessionOwner: () => Promise.resolve(undefined),
        sessionSeen: () => Promise.resolve(false),
        setSessionTitle: () => Promise.resolve(),
        readDoc: (doc) => Promise.resolve(doc.definition.initial()),
        setSessionMark: () => undefined,
        toolOwner: () => undefined,
        notifySessionChanged: () => undefined,
        notify: () => undefined,
    };
}

void describe("the codemode section", () => {
    const context = BACKGROUND_CONTEXT;
    const faux = fauxProvider({ models: [{ id: "m1" }] });
    let dir: string;
    let harness: Harness;
    let registry: ReturnType<typeof createRegistry>;
    let prompts: string[];

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "codemode-section-"));
        roots.push(dir);
        prompts = [];

        const models = createModels();

        models.setProvider(faux.provider);

        registry = createRegistry();

        registry.install(CodingTools);
        registry.install(codemode(hostOf(dir)));
        // Keeps the prompt from being empty for the wrong reason.
        registry.install(
            defineExtension({ name: "stand-in", sections: [section("other", () => "OTHER-TEXT")] }),
        );
        harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dir }) },
            context,
        );
        harness.resume();
    });

    afterEach(async () => {
        await harness.close(context);
    });

    /** One question to a fresh conversation: the system prompt the model was given, and the tools offered. */
    async function ask(withoutCodemode = false): Promise<{ prompt: string; tools: string[] }> {
        faux.setResponses([
            (request: TranscriptContext) => {
                prompts.push(
                    JSON.stringify(request.messages.filter((each) => each.role === "system")),
                );

                return fauxAssistantMessage("ok");
            },
        ]);

        const conversation = await harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: {
                    model: { provider: faux.provider.id, modelId: "m1" },
                    thinkingLevel: "off",
                    cwd: dir,
                    ...(withoutCodemode
                        ? {
                              tools: registry
                                  .snapshot()
                                  .tools()
                                  .map((each) => each.tool)
                                  .filter((tool) => tool.name !== "codemode"),
                          }
                        : {}),
                },
            },
            context,
        );

        await (await conversation.submit({ type: "input", content: "hi" }, context)).wait(context);

        const agent = await conversation.agent(context);

        return { prompt: prompts.at(-1) ?? "", tools: agent.tools.map((tool) => tool.name) };
    }

    void it("lists the tools a script can call where the tool is offered, and nowhere else", async () => {
        const offered = await ask();
        const narrowed = await ask(true);

        assert.match(offered.prompt, /<other>/);
        assert.match(narrowed.prompt, /<other>/);
        assert.ok(offered.tools.includes("codemode"), offered.tools.join(", "));
        assert.ok(!narrowed.tools.includes("codemode"), narrowed.tools.join(", "));

        const catalog = /<codemode>(.*?)<\/codemode>/s.exec(offered.prompt)?.[1] ?? "";

        // `codemode` itself is callable by the model only, so its own declaration is not one a script may call.
        assert.match(catalog, /### `read`/);
        assert.doesNotMatch(catalog, /### `codemode`/);
        assert.doesNotMatch(narrowed.prompt, /<codemode>/);
    });
});
