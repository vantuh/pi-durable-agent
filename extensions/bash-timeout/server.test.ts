/**
 * The limit belongs to the extension: every bash call is capped to the saved minutes, a shorter
 * timeout of the model's own is left alone, and the file is read on each call so a save is in force
 * without a reload. A command the limit killed is said in the browsers, which only the limit's own
 * timeout is: the model's shorter one and every other failure stay in the transcript.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
    type Extension,
    type JsonObject,
    ToolTask,
    type ToolExecutionResult,
} from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";
import { ActionError } from "../../server/sdk.ts";
import type { ExtensionNotice } from "../../shared/protocol.ts";
import { DEFAULT_MINUTES, FILE, MAX_MINUTES, MIN_MINUTES } from "./refs.ts";
import bashTimeout, { actions } from "./server.ts";

/** A host that keeps what the extension says in the browsers. */
type Captured = {
    host: Host;
    /** Every notice the extension sent, in order. */
    said: ExtensionNotice[];
};

function hostIn(dataDir: string): Captured {
    const said: ExtensionNotice[] = [];
    const host: Host = {
        name: "bash-timeout",
        cwd: dataDir,
        dataDir,
        log: () => undefined,
        onCommit: () => undefined,
        onDispose: () => undefined,
        shapeModelRequests: () => undefined,
        registerModelProvider: () => () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: (session) => Promise.resolve(`Session ${String(session)}`),
        sessionName: () => Promise.resolve(null),
        setSessionTitle: () => Promise.resolve(),
        readDoc: (doc) => Promise.resolve(doc.definition.initial()),
        setSessionMark: () => undefined,
        folderGroup: () => undefined,
        notifySessionChanged: () => undefined,
        notify: (notice) => {
            said.push(notice);
        },
    };

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
        assert.equal(
            await settle(call, timeoutResult(DEFAULT_MINUTES * 60), api),
            undefined,
            "the result must be kept as the harness wrote it",
        );
        assert.deepEqual(captured.said, [
            {
                level: "error",
                message: "Session 12",
                session: 12,
                description: "Bash timed out after 10 min · sleep 91; echo done · pi-durable-agent",
            },
        ]);
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
