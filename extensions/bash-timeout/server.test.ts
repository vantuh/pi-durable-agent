/**
 * The limit belongs to the extension: every bash call is capped to the saved minutes, a shorter
 * timeout of the model's own is left alone, and the file is read on each call so a save is in force
 * without a reload. A command the limit killed is said in the browsers, which only the limit's own
 * timeout is: the model's shorter one and every other failure stay in the transcript.
 *
 * The idle guard is checked against the real `bash` tool and a real `NodeExecutionEnv` in a real
 * Harness, because what it has to survive — the abort the env throws, the spill file, the retained
 * output — is pi's, and a stand-in would prove only that the stand-in behaves.
 */

import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
    fauxToolCall,
} from "@earendil-works/pi-ai";
import {
    createRegistry,
    defineExtension,
    defineTool,
    type EntryRecord,
    type Extension,
    Harness,
    type JsonObject,
    ToolTask,
    type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { obj, str } from "@earendil-works/pi-schema";

import type { Action, Host } from "../../server/sdk.ts";
import { ActionError } from "../../server/sdk.ts";
import type { ExtensionNotice } from "../../shared/protocol.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { DEFAULT_MINUTES, FILE, IDLE_CODE, MAX_MINUTES, MIN_MINUTES } from "./refs.ts";
import bashTimeout, { actions, idleGuard } from "./server.ts";

/** A host that keeps what the extension says in the browsers. */
type Captured = {
    host: Host;
    /** Every notice the extension sent, in order. */
    said: ExtensionNotice[];
};

function hostIn(dataDir: string): Captured {
    const said: ExtensionNotice[] = [];
    const host: Host = testHost({
        name: "bash-timeout",
        cwd: dataDir,
        dataDir,
        sessionTitle: (session) => Promise.resolve(`Session ${String(session)}`),
        notify: (notice) => {
            said.push(notice);
        },
    });

    return { host, said };
}

/** The folder the api reports for the conversation, as `pi.agent` keeps it; null for a conversation without one. */
const CWD = "/Users/someone/projects/pi-durable-agent";

/**
 * The hook api as the harness builds it: the call's own memos, written before the call and read after
 * it, the conversation the call belongs to, and that conversation's agent.
 */
function callApi(conversationId: number, cwd: string | null = CWD) {
    const memos = new Map<string, unknown>();

    return {
        conversationId,
        snapshot: () => Promise.resolve(cwd === null ? undefined : { cwd }),
        memo: (name: string, ...rest: unknown[]): Promise<unknown> => {
            if (rest.length === 1) {
                return Promise.resolve(memos.get(name));
            }

            const [candidate] = rest;
            const winner = memos.has(name) ? memos.get(name) : candidate;

            memos.set(name, winner);

            return Promise.resolve(winner);
        },
    };
}

type Hook = (call: unknown, ...rest: unknown[]) => Promise<unknown>;

/** One of the extension's tool hooks, called as the harness calls it: the call, then whatever follows. */
function hookOf(extension: Extension, name: "beforeTool" | "afterTool"): Hook {
    const handlers: unknown = extension.hooks?.find(
        (entry) => entry.task === ToolTask.definition.name,
    )?.handlers;
    const handler: unknown =
        typeof handlers === "object" && handlers !== null ? Reflect.get(handlers, name) : undefined;

    if (typeof handler !== "function") {
        throw new Error(`bash-timeout installs no ${name} hook`);
    }

    return async (call, ...rest) => await Reflect.apply(handler, undefined, [call, ...rest]);
}

/** One call as the harness makes it: one host, one extension and one api, so afterTool reads beforeTool's memo. */
function callIn(dataDir: string, session = 7, cwd: string | null = CWD) {
    const captured = hostIn(dataDir);
    const extension = bashTimeout(captured.host);

    return {
        captured,
        api: callApi(session, cwd),
        decide: hookOf(extension, "beforeTool"),
        settle: hookOf(extension, "afterTool"),
    };
}

/** The arguments the hook hands on, or undefined when it leaves the call as the model sent it. */
function applied(result: unknown): unknown {
    if (result === undefined) {
        return undefined;
    }

    if (typeof result !== "object" || result === null) {
        assert.fail("the hook must answer an object or nothing");
    }

    assert.equal(Reflect.get(result, "block"), undefined, "the call must not be blocked");

    return Reflect.get(result, "arguments");
}

/** What pi's bash tool settles as when the environment kills the command at `seconds`. */
function timeoutResult(seconds: number): ToolExecutionResult {
    return {
        isError: true,
        diagnostics: [
            {
                severity: "error",
                code: "tool_error",
                message: `Command timed out after ${String(seconds)} seconds`,
            },
        ],
    };
}

/** The extension's `beforeTool`, with a host of its own for a test that only watches the arguments. */
function beforeTool(
    dataDir: string,
    captured = hostIn(dataDir),
): (name: string, args: JsonObject) => Promise<unknown> {
    const decide = hookOf(bashTimeout(captured.host), "beforeTool");

    return async (name, args) => await decide({ name, arguments: args }, callApi(1));
}

function actionOf(dataDir: string, name: string): Action {
    const action = actions(hostIn(dataDir).host)[name];

    assert.ok(action !== undefined, `no ${name} action`);

    return action;
}

void describe("bash timeout", () => {
    let dir: string;

    async function write(minutes: unknown): Promise<void> {
        await writeFile(join(dir, FILE), JSON.stringify({ minutes }));
    }

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "bash-timeout-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("gives a bash call without a timeout the default limit", async () => {
        const decide = beforeTool(dir);

        assert.deepEqual(applied(await decide("bash", { command: "sleep 1" })), {
            command: "sleep 1",
            timeout: DEFAULT_MINUTES * 60,
        });
    });

    void it("caps a bash call that asks for longer than the limit", async () => {
        await write(2);

        assert.deepEqual(applied(await beforeTool(dir)("bash", { command: "x", timeout: 3600 })), {
            command: "x",
            timeout: 120,
        });
    });

    void it("leaves a shorter timeout and every other tool as the model sent them", async () => {
        const decide = beforeTool(dir);

        assert.equal(applied(await decide("bash", { command: "x", timeout: 30 })), undefined);
        assert.equal(applied(await decide("bash", { command: "x", timeout: 600 })), undefined);
        assert.equal(applied(await decide("read", { path: "a.txt" })), undefined);
    });

    void it("replaces a timeout that is not a positive number with the limit", async () => {
        const decide = beforeTool(dir);
        const asked = { command: "x" };

        for (const timeout of [0, -5, Number.NaN, "5"]) {
            assert.deepEqual(applied(await decide("bash", { ...asked, timeout })), {
                ...asked,
                timeout: 600,
            });
        }
    });

    void it("reads the limit on each call, so a new file is in force without a reload", async () => {
        const decide = beforeTool(dir);

        assert.deepEqual(applied(await decide("bash", { command: "x" })), {
            command: "x",
            timeout: DEFAULT_MINUTES * 60,
        });

        await write(7);

        assert.deepEqual(applied(await decide("bash", { command: "x" })), {
            command: "x",
            timeout: 420,
        });
    });

    void it("falls back to the default when the file is missing, broken or out of range", async () => {
        const decide = beforeTool(dir);
        const asked = { command: "x" };

        await writeFile(join(dir, FILE), "not json");
        assert.deepEqual(applied(await decide("bash", asked)), { ...asked, timeout: 600 });

        await write(0);
        assert.deepEqual(applied(await decide("bash", asked)), { ...asked, timeout: 600 });

        await write("5");
        assert.deepEqual(applied(await decide("bash", asked)), { ...asked, timeout: 600 });
    });

    void it("saves a whole number of minutes and refuses anything else", async () => {
        const save = actionOf(dir, "saveSettings");
        const read = actionOf(dir, "settings");

        assert.deepEqual(await read({ args: undefined, session: null }), {
            minutes: DEFAULT_MINUTES,
        });
        assert.deepEqual(await save({ args: { minutes: 5 }, session: null }), { minutes: 5 });
        assert.equal(await readFile(join(dir, FILE), "utf8"), '{"minutes":5}\n');

        for (const minutes of [MIN_MINUTES - 1, MAX_MINUTES + 1, 2.5, "5", undefined]) {
            await assert.rejects(
                async () => await save({ args: { minutes }, session: null }),
                ActionError,
            );
        }

        assert.deepEqual(await read({ args: undefined, session: null }), { minutes: 5 });
        assert.deepEqual(applied(await beforeTool(dir)("bash", { command: "x" })), {
            command: "x",
            timeout: 300,
        });
    });

    void it("says in the browser that the limit killed the command", async () => {
        const { captured, api, decide, settle } = callIn(dir, 12);
        const call = { id: "call-1", name: "bash", arguments: { command: "sleep 91; echo done" } };

        assert.deepEqual(applied(await decide(call, api)), {
            command: "sleep 91; echo done",
            timeout: DEFAULT_MINUTES * 60,
        });
        await settle(call, timeoutResult(DEFAULT_MINUTES * 60), api);
        assert.deepEqual(captured.said, [
            {
                level: "error",
                message: "Session 12",
                session: 12,
                description: "Bash timed out after 10 min · sleep 91; echo done · pi-durable-agent",
            },
        ]);
    });

    void it("tells the model which clock ran out", async () => {
        const { api, decide, settle } = callIn(dir);
        const call = { id: "call-3", name: "bash", arguments: { command: "sleep 700" } };

        await decide(call, api);

        assert.deepEqual(await settle(call, timeoutResult(DEFAULT_MINUTES * 60), api), {
            isError: true,
            diagnostics: [
                {
                    severity: "error",
                    code: "tool_error",
                    message:
                        "Command timed out after 600 seconds — the agent's shared bash limit (10 min), not a timeout you asked for. The command was killed, not finished: the output above is everything it printed. Split it into smaller steps or narrow its scope.",
                },
            ],
        });
    });

    void it("leaves the timeout the model asked for itself as pi wrote it", async () => {
        const { api, decide, settle } = callIn(dir);
        const call = {
            id: "call-4",
            name: "bash",
            arguments: { command: "sleep 40", timeout: 30 },
        };

        await decide(call, api);

        assert.equal(
            await settle(call, timeoutResult(30), api),
            undefined,
            "the model's own timeout is not the agent's limit, and is not explained as one",
        );
    });

    void it("does not say a timeout the model asked for itself", async () => {
        const { captured, api, decide, settle } = callIn(dir);
        const call = {
            id: "call-2",
            name: "bash",
            arguments: { command: "sleep 40", timeout: 30 },
        };

        assert.equal(applied(await decide(call, api)), undefined);
        assert.equal(await settle(call, timeoutResult(30), api), undefined);
        assert.deepEqual(captured.said, []);
    });

    void it("does not say another bash failure or another tool's timeout", async () => {
        const { captured, api, decide, settle } = callIn(dir);
        const bash = { id: "call-3", name: "bash", arguments: { command: "false" } };
        const read = { id: "call-4", name: "read", arguments: { path: "a.txt" } };
        const failed: ToolExecutionResult = {
            isError: true,
            diagnostics: [
                { severity: "error", code: "exit_code", message: "Command exited with code 2" },
            ],
        };

        await decide(bash, api);
        await settle(bash, failed, api);
        await decide(read, api);
        await settle(read, timeoutResult(DEFAULT_MINUTES * 60), api);

        assert.deepEqual(captured.said, []);
    });

    void it("falls back to New session and to no folder, and cuts a long command short", async () => {
        const captured = hostIn(dir);
        const extension = bashTimeout({
            ...captured.host,
            sessionTitle: () => Promise.resolve(null),
        });
        const api = callApi(3, null);
        const command = `sleep 91; echo ${"x".repeat(100)}`;
        const call = { id: "call-5", name: "bash", arguments: { command } };

        await write(1);
        await hookOf(extension, "beforeTool")(call, api);
        await hookOf(extension, "afterTool")(call, timeoutResult(60), api);

        assert.deepEqual(captured.said, [
            {
                level: "error",
                message: "New session",
                session: 3,
                description: `Bash timed out after 1 min · ${command.slice(0, 59)}…`,
            },
        ]);
    });

    void it("leaves a result the harness wrote for a call that never reached beforeTool, as Pi 1.5 hands it on", async () => {
        const { captured, api, settle } = callIn(dir);
        const refused = { id: "call-9", name: "bash", arguments: { cmd: "sleep 91" } };
        const result: ToolExecutionResult = {
            isError: true,
            diagnostics: [
                {
                    severity: "error",
                    code: "invalid_arguments",
                    message: "command: required property is missing",
                },
            ],
        };

        assert.equal(await settle(refused, result, api), undefined);
        assert.deepEqual(captured.said, [], "no notice for a command that never ran");
    });

    void it("keeps the one decision a call was admitted with, whatever the setting says later", async () => {
        const capped = callIn(dir, 5);
        const asked = { id: "call-6", name: "bash", arguments: { command: "sleep 91" } };
        const own = callIn(dir, 6);
        const short = {
            id: "call-7",
            name: "bash",
            arguments: { command: "sleep 40", timeout: 30 },
        };

        assert.deepEqual(applied(await capped.decide(asked, capped.api)), {
            command: "sleep 91",
            timeout: DEFAULT_MINUTES * 60,
        });
        assert.equal(applied(await own.decide(short, own.api)), undefined);

        // A save between the two attempts of one call, as a crash and a resume would find it.
        await write(1);

        assert.deepEqual(
            applied(await capped.decide(asked, capped.api)),
            { command: "sleep 91", timeout: DEFAULT_MINUTES * 60 },
            "the resumed attempt runs on the timeout it was admitted with",
        );
        assert.equal(
            applied(await own.decide(short, own.api)),
            undefined,
            "and a timeout the model asked for stays its own",
        );
    });
});

/** A tool that runs `bash` as a nested call, as a script, a subagent or another tool does. */
const NestedBash = defineTool({
    name: "nested-bash",
    description: "Runs a bash command as a nested call and reports what that call was told.",
    parameters: obj({ command: str() }, { open: true }),
    async execute(args, api, context) {
        const nested = await api.executeTool("bash", { command: args.command }, context);

        return {
            output: [
                {
                    type: "text",
                    text: nested.diagnostics
                        .map((diagnostic) => `${diagnostic.code ?? "-"}: ${diagnostic.message}`)
                        .join("\n"),
                },
            ],
            isError: nested.isError,
        };
    },
});

/** One tool result as the transcript keeps it: the codes of its diagnostics, and the text the model read. */
type BashResult = { codes: string[]; text: string };

/** The diagnostic codes of one result, from its data: a code does not travel in the text the model reads. */
function codesOf(entry: EntryRecord): string[] {
    const data: unknown = entry.data;
    const diagnostics: unknown =
        typeof data === "object" && data !== null ? Reflect.get(data, "diagnostics") : undefined;

    if (!Array.isArray(diagnostics)) {
        return [];
    }

    return diagnostics.flatMap((diagnostic: unknown) => {
        const code: unknown =
            typeof diagnostic === "object" && diagnostic !== null
                ? Reflect.get(diagnostic, "code")
                : undefined;

        return typeof code === "string" ? [code] : [];
    });
}

/** What one result said to the model. */
function textOf(entry: EntryRecord): string {
    return (entry.model ?? [])
        .flatMap((message) =>
            message.role === "toolResult"
                ? message.content.flatMap((item) => (item.type === "text" ? [item.text] : []))
                : [],
        )
        .join("\n");
}

void describe("bash idle guard", () => {
    const opened: (() => Promise<void>)[] = [];

    afterEach(async () => {
        for (const close of opened.splice(0)) {
            await close();
        }
    });

    /**
     * A real Harness over a faux model, pi's own coding tools and this extension, with the idle guard shortened to
     * `idleSeconds`: the shipped one waits `IDLE_SECONDS`, which no test is going to sit through seven times.
     */
    async function guarded(idleSeconds: number) {
        const dir = await mkdtemp(join(tmpdir(), "bash-idle-"));
        const captured = hostIn(dir);
        const faux = fauxProvider({ models: [{ id: "m1" }] });
        const models = createModels();
        const registry = createRegistry();

        models.setProvider(faux.provider);
        registry.install(CodingTools);
        registry.install(bashTimeout(captured.host));
        // The same wrap the extension installs, with the wait a test can watch.
        registry.install(
            defineExtension({ name: "bash-idle-quick", wraps: [idleGuard(idleSeconds)] }),
        );
        registry.install(defineExtension({ name: "nested-bash", tools: [NestedBash] }));

        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dir }) },
            BACKGROUND_CONTEXT,
        );

        harness.resume();
        opened.push(async () => {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        });

        const conversation = await harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: { model: { provider: faux.provider.id, modelId: "m1" }, cwd: dir },
            },
            BACKGROUND_CONTEXT,
        );

        /** Every tool result of the conversation, in order. */
        async function results(): Promise<BashResult[]> {
            const view = await conversation.context(BACKGROUND_CONTEXT);

            return view.entries
                .filter((entry) => entry.kind === "pi.tool-result")
                .map((entry) => ({ codes: codesOf(entry), text: textOf(entry) }));
        }

        return {
            dir,
            captured,
            faux,
            conversation,
            results,
            /** One answer that makes these calls, then one that ends the run. */
            async round(...calls: { name: string; arguments: JsonObject }[]): Promise<void> {
                faux.setResponses([
                    fauxAssistantMessage(
                        calls.map((call) => fauxToolCall(call.name, call.arguments)),
                        { stopReason: "toolUse" },
                    ),
                    fauxAssistantMessage("done"),
                ]);
                await (
                    await conversation.submit({ type: "input", content: "go" }, BACKGROUND_CONTEXT)
                ).wait(BACKGROUND_CONTEXT);
            },
            /** The one result the run left, or a failed assertion. */
            async only(): Promise<BashResult> {
                const found = await results();
                const [first] = found;

                assert.equal(found.length, 1, JSON.stringify(found));
                assert.ok(first !== undefined);

                return first;
            },
        };
    }

    void it("ends a silent command after the idle wait, and says why", async () => {
        const bash = await guarded(1);
        const started = Date.now();

        await bash.round({ name: "bash", arguments: { command: "sleep 30" } });

        const elapsed = Date.now() - started;
        const result = await bash.only();

        assert.deepEqual(result.codes, [IDLE_CODE]);
        assert.match(result.text, /No output for 1s/);
        assert.ok(elapsed < 10_000, `the guard took ${String(elapsed)} ms, not about a second`);
    });

    void it("counts output on either stream as progress, so a talking command runs on", async () => {
        const bash = await guarded(1);
        const tape = "for i in 1 2 3 4 5 6 7 8; do echo tick; sleep 0.2; done";
        const errors = "for i in 1 2 3 4 5 6 7 8; do echo tick >&2; sleep 0.2; done";

        await bash.round(
            { name: "bash", arguments: { command: tape } },
            { name: "bash", arguments: { command: errors } },
        );

        const results = await bash.results();

        assert.equal(results.length, 2);

        for (const result of results) {
            assert.deepEqual(
                result.codes,
                [],
                `a command that prints is not killed: ${result.text}`,
            );
            assert.match(result.text, /tick/);
        }
    });

    void it("keeps the output a killed command already printed, and the path of all of it", async () => {
        const bash = await guarded(1);

        await bash.round({ name: "bash", arguments: { command: "seq 1 3000; sleep 30" } });

        const result = await bash.only();

        assert.ok(result.codes.includes(IDLE_CODE), result.codes.join(", "));
        assert.ok(result.codes.includes("full_output"), result.codes.join(", "));
        assert.match(result.text, /^3000$/m, "the retained tail still reaches the model");
    });

    void it("does not call a timeout a hang when the idle wait is longer", async () => {
        // The ceiling's smallest setting is a minute, so the call carries a timeout of its own instead: what the
        // wrapper has to get right is that a timeout is never turned into an idle kill.
        const bash = await guarded(90);

        await bash.round({ name: "bash", arguments: { command: "sleep 30", timeout: 1 } });

        const result = await bash.only();

        assert.ok(
            !result.codes.includes(IDLE_CODE),
            "the environment reports a timeout ahead of an abort, and that is what happened",
        );
        assert.match(result.text, /Command timed out after 1 seconds/);
    });

    void it("passes the caller's own abort through without calling it a hang", async () => {
        const bash = await guarded(30);
        const marker = join(bash.dir, "running");

        bash.faux.setResponses([
            fauxAssistantMessage(fauxToolCall("bash", { command: `touch ${marker}; sleep 30` }), {
                stopReason: "toolUse",
            }),
            fauxAssistantMessage("done"),
        ]);

        const submission = await bash.conversation.submit(
            { type: "input", content: "go" },
            BACKGROUND_CONTEXT,
        );

        // The abort has to land on a running command; the file says the shell really started.
        await running(marker);
        await bash.conversation.abort(BACKGROUND_CONTEXT);
        await submission.wait(BACKGROUND_CONTEXT);

        const results = await bash.results();

        assert.deepEqual(
            results.map((result) => result.codes),
            [["aborted"]],
            "the environment's abort, which the harness reports as its own",
        );
        assert.deepEqual(bash.captured.said, [], "Stop is not a hang");
    });

    void it("kills a call the ceiling never touched, and reports it", async () => {
        const bash = await guarded(1);

        await bash.round({ name: "bash", arguments: { command: "sleep 30", timeout: 30 } });

        const result = await bash.only();

        assert.deepEqual(result.codes, [IDLE_CODE]);
        assert.deepEqual(
            bash.captured.said.map((notice) => notice.description),
            [`Bash idle for 1 s · sleep 30 · ${basename(bash.dir)}`],
        );
    });

    void it("reaches a nested call, not only the call the model makes", async () => {
        const bash = await guarded(1);

        await bash.round({ name: "nested-bash", arguments: { command: "sleep 30" } });

        const result = await bash.only();

        assert.match(result.text, new RegExp(`^${IDLE_CODE}: No output for 1s`, "m"));
    });
});

/** Waits until the command has created `marker`, so the next step acts on a process that is really running. */
async function running(marker: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        try {
            await access(marker);

            return;
        } catch {
            await delay(25);
        }
    }

    assert.fail(`${marker} was never created: the command never ran`);
}
