import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";

import { createRegistry } from "@earendil-works/pi-durable";

import { ActionError, ActionNotFound, Extensions, parseActionBody } from "../server/extensions.ts";
import type { ExtensionNotice } from "../shared/protocol.ts";

const CALLS = "__extensionTestCalls";

function calls(): string[] {
    const value: unknown = Reflect.get(globalThis, CALLS);

    if (!Array.isArray(value)) {
        throw new Error("calls not initialised");
    }

    return value.filter((entry): entry is string => typeof entry === "string");
}

/** A server.ts that registers one disposer per entry of `tags`, each recording `tag`. */
function source(options: { tags: string[]; name?: string; throwAfter?: boolean; body?: string }) {
    const registrations = options.tags
        .map(
            (tag) =>
                `host.onDispose(${tag.startsWith("rej") ? "async " : ""}() => { globalThis.${CALLS}.push(${JSON.stringify(tag)}); ${
                    tag.startsWith("bad") || tag.startsWith("rej") ? `throw new Error("boom");` : ""
                } });`,
        )
        .join("\n");

    return `
export default function (host) {
    ${registrations}
    ${options.throwAfter === true ? `throw new Error("broken");` : ""}
    ${options.body ?? `return { name: ${options.name ?? "host.name"} };`}
}
`;
}

void describe("Extensions disposers", () => {
    let root: string;
    let dir: string;
    let logs: string[];
    let notices: ExtensionNotice[];
    let extensions: Extensions;

    async function write(folder: string, text: string): Promise<void> {
        await mkdir(join(dir, folder), { recursive: true });
        await writeFile(join(dir, folder, "server.ts"), text);
    }

    void it("request shapers follow reload, failure, disabling and removal", async () => {
        const model = { provider: "test" };
        const module = (value: string, fail = false) => `export default function(host) {
            host.shapeModelRequests(() => ${JSON.stringify(value)});
            host.wrapModelFetch((next) => next);
            ${fail ? 'throw new Error("broken");' : "return { name: host.name };"}
        }`;
        await write("shape", module("one"));
        await extensions.load();
        assert.equal(extensions.requestShapers[0]?.({}, model), "one");
        assert.equal(extensions.fetchWrappers.length, 1);
        await write("shape", module("failed", true));
        await extensions.load();
        assert.equal(extensions.requestShapers.length, 1);
        assert.equal(extensions.requestShapers[0]?.({}, model), "one");
        await write("shape", module("two"));
        await extensions.load();
        assert.equal(extensions.requestShapers.length, 1);
        assert.equal(extensions.requestShapers[0]?.({}, model), "two");
        assert.equal(extensions.fetchWrappers.length, 1);
        await extensions.setEnabled("shape", false);
        assert.equal(extensions.requestShapers.length, 0);
        assert.equal(extensions.fetchWrappers.length, 0);
        await extensions.setEnabled("shape", true);
        assert.equal(extensions.requestShapers.length, 1);
        await rm(join(dir, "shape"), { recursive: true });
        await extensions.load();
        assert.equal(extensions.requestShapers.length, 0);
    });

    void it("keeps the live model provider when the replacement's build fails", async () => {
        // Mimics the real registry: replace by id, and unregister only what is still in place.
        const providers = new Map<string, unknown>();
        const registering = (fail: boolean): string => `export default function (host) {
            host.registerModelProvider({ id: "p" });
            ${fail ? 'throw new Error("broken");' : "return { name: host.name };"}
        }`;
        const versioned = new Extensions({
            notify: (notice) => {
                notices.push(notice);
            },
            registry: createRegistry(),
            dir,
            cwd: root,
            dataDir: root,
            log: () => undefined,
            registerModelProvider: (provider) => {
                providers.set(provider.id, provider);

                return () => {
                    if (providers.get(provider.id) === provider) {
                        providers.delete(provider.id);
                    }
                };
            },
        });

        try {
            await write("alpha", registering(false));
            await versioned.load(new Set(["alpha"]));
            const live = providers.get("p");

            assert.notEqual(live, undefined);

            await write("alpha", registering(true));
            await versioned.load(new Set(["alpha"]));

            assert.deepEqual(versioned.names, ["alpha"]);
            assert.equal(providers.get("p"), live);
            assert.deepEqual(
                notices.filter(({ level }) => level === "error"),
                [
                    {
                        level: "error",
                        message:
                            "Could not load extension “alpha”: broken. Previous version is still active.",
                    },
                ],
            );
        } finally {
            await versioned.dispose();
        }
    });

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "extensions-test-"));
        dir = join(root, "extensions");
        logs = [];
        notices = [];
        await mkdir(dir);
        Reflect.set(globalThis, CALLS, []);
        extensions = new Extensions({
            notify: (notice) => {
                notices.push(notice);
            },
            registry: createRegistry(),
            dir,
            cwd: root,
            dataDir: root,
            log: (message) => {
                logs.push(message);
            },
        });
    });

    afterEach(async () => {
        await extensions.dispose();
        await rm(root, { recursive: true, force: true });
    });

    /** Waits until `count` notices have arrived, which is how a watcher load makes itself known. */
    async function nextNotice(count: number): Promise<ExtensionNotice | undefined> {
        const deadline = Date.now() + 5000;
        while (notices.length < count && Date.now() < deadline) {
            await setTimeout(20);
        }
        assert.equal(notices.length, count);
        return notices[count - 1];
    }

    void it("watches only the changed folder and reports reload, failure, recovery and removal", async () => {
        await write("alpha", source({ tags: ["alpha-v1"] }));
        await write("beta", source({ tags: ["beta"] }));
        await extensions.load();
        assert.deepEqual(notices, []);
        // macOS FSEvents can still deliver the writes above to a watcher started right after them.
        await setTimeout(500);
        extensions.watch();

        await write("alpha", source({ tags: ["alpha-v2"] }));
        assert.deepEqual(await nextNotice(1), {
            level: "success",
            message: "Extension “alpha” reloaded",
        });
        assert.deepEqual(calls(), ["alpha-v1"]);

        await write("alpha", source({ tags: ["failed"], throwAfter: true }));
        assert.deepEqual(await nextNotice(2), {
            level: "error",
            message: "Could not load extension “alpha”: broken. Previous version is still active.",
        });
        assert.ok(extensions.names.includes("alpha"));
        assert.deepEqual(calls(), ["alpha-v1", "failed"]);

        await write("alpha", source({ tags: ["alpha-v3"] }));
        assert.deepEqual(await nextNotice(3), {
            level: "success",
            message: "Extension “alpha” reloaded",
        });
        assert.deepEqual(extensions.failed, []);
        assert.deepEqual(calls(), ["alpha-v1", "failed", "alpha-v2"]);

        await rm(join(dir, "alpha", "server.ts"));
        assert.deepEqual(await nextNotice(4), {
            level: "success",
            message: "Extension “alpha” removed",
        });
        assert.deepEqual(extensions.names, ["beta"]);
        assert.deepEqual(calls(), ["alpha-v1", "failed", "alpha-v2", "alpha-v3"]);

        await write("alpha", source({ tags: ["alpha-new"] }));
        assert.deepEqual(await nextNotice(5), {
            level: "success",
            message: "Extension “alpha” loaded",
        });
    });

    void it("reloads a folder only when its server code changes", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();
        // macOS FSEvents can still deliver the writes above to a watcher started right after them.
        await setTimeout(500);
        extensions.watch();

        await writeFile(join(dir, "alpha", "web.tsx"), "export default { status: [] };\n");
        await writeFile(join(dir, "alpha", "server.test.ts"), "export {};\n");
        await writeFile(join(dir, "alpha", "README.md"), "# alpha\n");
        // A negative needs a wait: the watcher loads after 150 ms of quiet, so this is far past it.
        // The reloads below wait on their notice instead.
        await setTimeout(600);
        assert.deepEqual(notices, []);
        assert.deepEqual(calls(), []);

        await write("alpha", source({ tags: ["v2"] }));
        assert.deepEqual(await nextNotice(1), {
            level: "success",
            message: "Extension “alpha” reloaded",
        });
        assert.deepEqual(calls(), ["v1"]);

        // The folder itself, not only the files in it: a removal arrives as the folder's path.
        await rm(join(dir, "alpha"), { recursive: true });
        assert.deepEqual(await nextNotice(2), {
            level: "success",
            message: "Extension “alpha” removed",
        });
        assert.deepEqual(calls(), ["v1", "v2"]);
    });

    void it("keeps failures from untouched folders during a targeted reload", async () => {
        await write("alpha", source({ tags: [], throwAfter: true }));
        await write("beta", source({ tags: [] }));
        await extensions.load();
        await extensions.load(new Set(["beta"]));
        assert.deepEqual(extensions.failed, [{ folder: "alpha", reason: "broken" }]);
    });

    void it("runs the old disposer once on reload and not the new one", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();
        assert.deepEqual(calls(), []);

        await write("alpha", source({ tags: ["v2"] }));
        await extensions.load();

        assert.deepEqual(calls(), ["v1"]);
        assert.deepEqual(extensions.names, ["alpha"]);
    });

    void it("keeps the old version and its disposer when the replacement fails", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await write("alpha", source({ tags: ["v2"], throwAfter: true }));
        await extensions.load();

        assert.deepEqual(calls(), ["v2"]);
        assert.deepEqual(extensions.names, ["alpha"]);
        assert.equal(extensions.failed[0]?.folder, "alpha");

        await extensions.dispose();
        assert.deepEqual(calls(), ["v2", "v1"]);
    });

    void it("runs the failed attempt's disposer when the name is wrong", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await write("alpha", source({ tags: ["v2"], name: '"other"' }));
        await extensions.load();

        assert.deepEqual(calls(), ["v2"]);
        assert.deepEqual(extensions.names, ["alpha"]);
    });

    void it("runs the disposer when the folder is removed", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await rm(join(dir, "alpha"), { recursive: true });
        await extensions.load();

        assert.deepEqual(calls(), ["v1"]);
        assert.deepEqual(extensions.names, []);
    });

    void it("drops the old version when the new one installs nothing, and keeps the new disposers", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await write("alpha", source({ tags: ["v2"], body: "return undefined;" }));
        await extensions.load();

        assert.deepEqual(calls(), ["v1"]);
        assert.deepEqual(extensions.names, []);

        await extensions.dispose();
        assert.deepEqual(calls(), ["v1", "v2"]);
    });

    void it("dispose runs the disposers of every folder once", async () => {
        await write("alpha", source({ tags: ["a1", "a2"] }));
        await write("beta", source({ tags: ["b1"] }));
        await extensions.load();

        await extensions.dispose();
        await extensions.dispose();

        assert.deepEqual(calls().sort(), ["a1", "a2", "b1"]);
    });

    void it("a throwing disposer is logged and does not block the others", async () => {
        await write("alpha", source({ tags: ["bad1", "good"] }));
        await extensions.load();

        await write("alpha", source({ tags: ["next"] }));
        await extensions.load();

        assert.deepEqual(calls(), ["bad1", "good"]);
        assert.ok(logs.some((line) => line.includes("alpha: dispose failed: boom")));
        assert.deepEqual(extensions.names, ["alpha"]);
    });

    void it("an async disposer that rejects is logged and does not block the others", async () => {
        await write("alpha", source({ tags: ["rej1", "good"] }));
        await extensions.load();

        await extensions.dispose();

        assert.deepEqual(calls(), ["rej1", "good"]);
        assert.ok(logs.some((line) => line.includes("alpha: dispose failed: boom")));
    });

    void it("keeps the old version when the export is bad, and runs only the attempt's disposer", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await write("alpha", source({ tags: ["v2"], body: "return {};" }));
        await extensions.load();

        assert.deepEqual(calls(), ["v2"]);
        assert.deepEqual(extensions.names, ["alpha"]);
        assert.equal(extensions.failed[0]?.folder, "alpha");

        await extensions.dispose();
        assert.deepEqual(calls(), ["v2", "v1"]);
    });

    void it("dispose still runs the disposers after a load failed", async () => {
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        await rm(dir, { recursive: true });
        await assert.rejects(extensions.load());
        await extensions.dispose();

        assert.deepEqual(calls(), ["v1"]);
    });

    void it("a failed load does not stop later loads", async () => {
        await rm(dir, { recursive: true });
        await assert.rejects(extensions.load());

        await mkdir(dir);
        await write("alpha", source({ tags: ["v1"] }));
        await extensions.load();

        assert.deepEqual(extensions.names, ["alpha"]);
    });

    void it("a reload runs a changed helper, also in a subfolder", async () => {
        const helper = (tag: string): string =>
            `import { deep } from "./lib/deep.ts";\nexport const value = "${tag}:" + deep;`;
        const main = `
import { value } from "./helper.ts";
export default function (host) {
    globalThis.${CALLS}.push(value);
    return { name: host.name };
}
`;

        await write("alpha", main);
        await mkdir(join(dir, "alpha", "lib"));
        await writeFile(join(dir, "alpha", "helper.ts"), helper("h1"));
        await writeFile(join(dir, "alpha", "lib", "deep.ts"), 'export const deep = "d1";');
        await extensions.load();

        await writeFile(join(dir, "alpha", "helper.ts"), helper("h2"));
        await writeFile(join(dir, "alpha", "lib", "deep.ts"), 'export const deep = "d2";');
        await extensions.load();

        assert.deepEqual(calls(), ["h1:d1", "h2:d2"]);
    });

    void it("a package import stays one instance across reloads", async () => {
        const text = `
import { defineExtension } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-durable"))};
export default function (host) {
    globalThis.${CALLS}.push(String(defineExtension.name) + ":" + (globalThis.__seen ??= new Set()).size);
    (globalThis.__seen).add(defineExtension);
    return { name: host.name };
}
`;

        await write("alpha", text);
        await extensions.load();
        await write("alpha", `${text}\n// changed`);
        await extensions.load();

        const seen: unknown = Reflect.get(globalThis, "__seen");

        assert.ok(seen instanceof Set);
        assert.equal(seen.size, 1);
    });

    const withActions = (actions: string): string =>
        `export default function (host) { return { name: host.name }; }\nexport const actions = ${actions};`;
    const call = { args: 1, session: { id: 7, cwd: "/work" } };

    void it("dispatches an action with its args and session", async () => {
        await write("alpha", withActions("{ echo: (call) => call, other: () => 'no' }"));
        await write("beta", withActions("{ echo: () => 'beta' }"));
        await extensions.load();

        assert.deepEqual(await extensions.call("alpha", "echo", call), call);
        assert.equal(await extensions.call("beta", "echo", call), "beta");
    });

    void it("tells an unknown extension from an unknown action", async () => {
        await write("alpha", withActions("{ echo: () => 1 }"));
        await extensions.load();

        await assert.rejects(
            extensions.call("nope", "echo", call),
            (error) =>
                error instanceof ActionNotFound && error.message.includes('no extension "nope"'),
        );
        await assert.rejects(
            extensions.call("alpha", "nope", call),
            (error) =>
                error instanceof ActionNotFound && error.message.includes('no action "nope"'),
        );
        await assert.rejects(
            extensions.call("alpha", "constructor", call),
            (error) =>
                error instanceof ActionNotFound &&
                error.message.includes('no action "constructor"'),
        );
    });

    void it("tells ActionError from another error", async () => {
        const failing = `{
            bad: () => { throw new (globalThis.__ActionError)("bad input"); },
            crash: () => { throw new Error("crash"); },
        }`;

        Reflect.set(globalThis, "__ActionError", ActionError);
        await write("alpha", withActions(failing));
        await extensions.load();

        await assert.rejects(
            extensions.call("alpha", "bad", call),
            (error) => error instanceof ActionError && error.message === "bad input",
        );
        await assert.rejects(
            extensions.call("alpha", "crash", call),
            (error) => error instanceof Error && !(error instanceof ActionError),
        );
    });

    void it("a reload replaces the action's code", async () => {
        await write("alpha", withActions("{ value: () => 1 }"));
        await extensions.load();
        await write("alpha", withActions("{ value: () => 2 }"));
        await extensions.load();

        assert.equal(await extensions.call("alpha", "value", call), 2);
    });

    void it("a failed replacement keeps the old action working", async () => {
        await write("alpha", withActions("{ value: () => 1 }"));
        await extensions.load();

        await write("alpha", `${withActions("{ value: () => 2 }")}\nthrow new Error("broken");`);
        await extensions.load();

        assert.equal(extensions.failed[0]?.folder, "alpha");
        assert.equal(await extensions.call("alpha", "value", call), 1);
    });

    void it("a bad actions export fails the build and keeps the old version", async () => {
        await write("alpha", withActions("{ value: () => 1 }"));
        await extensions.load();

        for (const bad of ["{ value: 5 }", "[() => 1]", "'text'"]) {
            await write("alpha", withActions(bad));
            await extensions.load();

            assert.match(extensions.failed[0]?.reason ?? "", /actions|not a function/);
            assert.equal(await extensions.call("alpha", "value", call), 1);
        }
    });

    void it("removal, and an extension that installs nothing, drop the actions", async () => {
        await write("alpha", withActions("{ value: () => 1 }"));
        await write("beta", withActions("{ value: () => 1 }"));
        await extensions.load();

        await write(
            "beta",
            "export default function () {}\nexport const actions = { value: () => 1 };",
        );
        await rm(join(dir, "alpha"), { recursive: true });
        await extensions.load();

        for (const folder of ["alpha", "beta"]) {
            await assert.rejects(
                extensions.call(folder, "value", call),
                (error) => error instanceof ActionNotFound,
            );
        }
    });

    void it("checks the action request body", () => {
        assert.deepEqual(parseActionBody(undefined), { session: undefined, args: undefined });
        assert.deepEqual(parseActionBody({}), { session: undefined, args: undefined });
        assert.deepEqual(parseActionBody({ session: 3, args: { a: 1 } }), {
            session: 3,
            args: { a: 1 },
        });

        for (const bad of [
            [],
            "x",
            5,
            null,
            { session: 0 },
            { session: -1 },
            { session: 1.5 },
            { session: "1" },
        ]) {
            assert.throws(() => parseActionBody(bad), ActionError);
        }
    });

    void it("a failed install keeps the old actions and status", async () => {
        const version = (value: number, tools: string): string =>
            `export default function (host) { return { name: host.name, tools: ${tools} }; }
export const actions = { value: () => ${value} };
export const status = () => ({ text: "v${value}" });`;
        const view = { entries: [], contextWindow: () => undefined };

        await write("alpha", version(1, "[]"));
        await extensions.load();

        await write("alpha", version(2, '[{ name: "t" }, { name: "t" }]'));
        await extensions.load();

        assert.match(extensions.failed[0]?.reason ?? "", /two tools named t/);
        assert.equal(await extensions.call("alpha", "value", call), 1);
        assert.equal(extensions.statuses(view)[0]?.text, "v1");
    });

    void it("actions may be a function of the host", async () => {
        await write(
            "alpha",
            withActions("(host) => ({ where: () => host.name + ':' + host.dataDir })"),
        );
        await extensions.load();

        assert.equal(await extensions.call("alpha", "where", call), `alpha:${root}`);
    });

    void it("an actions function that throws or returns junk fails the build and keeps the old version", async () => {
        await write("alpha", withActions("{ value: () => 1 }"));
        await extensions.load();

        for (const bad of ["() => { throw new Error('nope'); }", "() => 5", "() => ({ x: 1 })"]) {
            await write("alpha", withActions(bad));
            await extensions.load();

            assert.equal(extensions.failed[0]?.folder, "alpha");
            assert.equal(await extensions.call("alpha", "value", call), 1);
        }
    });

    const withMeta = (meta: string): string =>
        `export const meta = ${meta};\n${withActions("{ value: () => 1 }")}`;
    const named = (tag: string): string =>
        `export const meta = { title: "T", description: "D" };\n${source({ tags: [tag], body: `globalThis.${CALLS}.push("default"); return { name: host.name };` })}\nexport const actions = { value: () => 1 };`;
    const make = (): Extensions =>
        new Extensions({
            registry: createRegistry(),
            dir,
            cwd: root,
            dataDir: root,
            log: () => undefined,
        });

    void it("reads meta and falls back to the folder name", async () => {
        await write("alpha", withMeta('{ title: "Alpha", description: "Does alpha." }'));
        await write("beta", withActions("{ value: () => 1 }"));
        await extensions.load();

        assert.deepEqual(
            extensions.list.map((entry) => [entry.name, entry.title, entry.description]),
            [
                ["alpha", "Alpha", "Does alpha."],
                ["beta", "beta", ""],
            ],
        );
    });

    void it("fails a folder whose meta is bad", async () => {
        for (const bad of [
            "{ title: 'T' }",
            "{ title: '', description: 'D' }",
            "'text'",
            "{ title: 1, description: 'D' }",
        ]) {
            await write("alpha", withMeta(bad));
            await extensions.load();

            assert.equal(extensions.failed[0]?.folder, "alpha");
            assert.match(extensions.failed[0]?.reason ?? "", /meta/);
            assert.equal(extensions.list[0]?.installed, false);
            assert.match(extensions.list[0]?.error ?? "", /meta/);
        }
    });

    void it("does not call or install a disabled folder", async () => {
        await write("alpha", named("v1"));
        await writeFile(join(root, "extensions.json"), JSON.stringify({ disabled: ["alpha"] }));
        await extensions.load();

        assert.deepEqual(extensions.names, []);
        assert.deepEqual(calls(), []);
        assert.equal(extensions.list[0]?.enabled, false);
        assert.equal(extensions.list[0]?.title, "T");
        await assert.rejects(
            extensions.call("alpha", "value", call),
            (error) => error instanceof ActionNotFound,
        );
    });

    void it("lists a disabled folder that fails to import, and drops its installed version", async () => {
        await write("alpha", named("v1"));
        await extensions.load();

        await write("alpha", 'throw new Error("cannot import");');
        await extensions.setEnabled("alpha", false);

        const entry = extensions.list[0];

        assert.equal(entry?.enabled, false);
        assert.equal(entry?.installed, false);
        assert.match(entry?.error ?? "", /cannot import/);
        assert.deepEqual(extensions.names, []);
        assert.deepEqual(calls(), ["default", "v1"]);

        await extensions.dispose();
        assert.deepEqual(calls(), ["default", "v1"]);
    });

    void it("disables live, runs the disposers, and enables again", async () => {
        await write("alpha", named("v1"));
        await extensions.load();
        assert.equal(await extensions.call("alpha", "value", call), 1);

        const off = await extensions.setEnabled("alpha", false);

        assert.deepEqual([off.enabled, off.installed], [false, false]);
        assert.deepEqual(calls(), ["default", "v1"]);
        assert.deepEqual(extensions.names, []);
        await assert.rejects(
            extensions.call("alpha", "value", call),
            (error) => error instanceof ActionNotFound,
        );

        const on = await extensions.setEnabled("alpha", true);

        assert.deepEqual([on.enabled, on.installed], [true, true]);
        assert.equal(await extensions.call("alpha", "value", call), 1);
        assert.deepEqual(extensions.names, ["alpha"]);
    });

    void it("toggling one folder leaves the others running", async () => {
        await write("alpha", source({ tags: ["alpha"] }));
        await write("beta", source({ tags: ["beta"] }));
        await extensions.load();

        await extensions.setEnabled("beta", false);
        await extensions.setEnabled("beta", true);

        assert.deepEqual(calls(), ["beta"]);
    });

    void it("refuses to toggle an unknown folder", async () => {
        await write("alpha", named("v1"));
        await extensions.load();

        await assert.rejects(
            extensions.setEnabled("nope", false),
            (error) => error instanceof ActionNotFound,
        );
    });

    void it("keeps the choice in a file that a new instance reads", async () => {
        await write("alpha", named("v1"));
        await write("beta", named("b1"));
        await extensions.load();
        await extensions.setEnabled("alpha", false);

        assert.deepEqual(JSON.parse(await readFile(join(root, "extensions.json"), "utf8")), {
            disabled: ["alpha"],
        });

        const next = make();

        try {
            await next.load();

            assert.deepEqual(next.names, ["beta"]);
            assert.deepEqual(
                next.list.map((entry) => [entry.name, entry.enabled]),
                [
                    ["alpha", false],
                    ["beta", true],
                ],
            );
        } finally {
            await next.dispose();
        }
    });

    void it("treats a broken or odd state file as all enabled", async () => {
        await write("alpha", named("v1"));

        for (const text of ["{ not json", "[]", '{"disabled":"alpha"}', '{"disabled":[1]}']) {
            await writeFile(join(root, "extensions.json"), text);
            await extensions.load();

            assert.deepEqual(extensions.names, ["alpha"], text);
        }
    });

    const VIEW = { session: { id: 1, cwd: null }, entries: [], busy: false };
    const listening = (tag: string, body = ""): string =>
        source({
            tags: [],
            body: `host.onCommit(async (view) => { globalThis.${CALLS}.push(${JSON.stringify(tag)} + view.session.id); ${body} }); return { name: host.name };`,
        });

    void it("calls commit listeners, and only the live version after a reload", async () => {
        await write("alpha", listening("v1:"));
        await extensions.load();
        extensions.publish(VIEW);
        await write("alpha", listening("v2:"));
        await extensions.load();
        extensions.publish(VIEW);

        // The second v2 call is the baseline replay of the newest view when v2 loaded.
        assert.deepEqual(calls(), ["v1:1", "v2:1", "v2:1"]);
    });

    void it("forgets a session's newest view, so a version that loads later is not replayed it", async () => {
        await write("alpha", listening("a:"));
        await extensions.load();
        extensions.publish({ ...VIEW, session: { id: 3, cwd: null } });
        extensions.publish({ ...VIEW, session: { id: 4, cwd: null } });
        extensions.forget(3);

        // A folder loaded later starts from the newest view of each session still worth hearing about.
        await write("beta", listening("b:"));
        await extensions.load(new Set(["beta"]));

        assert.deepEqual(calls(), ["a:3", "a:4", "b:4"]);
    });

    void it("keeps the old listener when the replacement fails", async () => {
        await write("alpha", listening("v1:"));
        await extensions.load();
        await write(
            "alpha",
            source({
                tags: [],
                throwAfter: true,
                body: "host.onCommit(() => { globalThis." + CALLS + ".push('bad'); });",
            }),
        );
        await extensions.load();
        extensions.publish(VIEW);

        assert.deepEqual(calls(), ["v1:1"]);
    });

    void it("stops listeners when the folder is disabled or removed", async () => {
        await write("alpha", listening("a:"));
        await write("beta", listening("b:"));
        await extensions.load();
        await extensions.setEnabled("alpha", false);
        await rm(join(dir, "beta"), { recursive: true });
        await extensions.load();
        extensions.publish(VIEW);

        assert.deepEqual(calls(), []);
    });

    void it("isolates a throw and a rejection, and logs no data", async () => {
        await write(
            "alpha",
            source({
                tags: [],
                body: 'host.onCommit(() => { throw new Error("secret"); }); return { name: host.name };',
            }),
        );
        await write(
            "beta",
            source({
                tags: [],
                body: 'host.onCommit(async () => { throw new Error("secret"); }); return { name: host.name };',
            }),
        );
        await write("gamma", listening("g:"));
        await extensions.load();
        extensions.publish(VIEW);
        await new Promise((done) => setImmediate(done));

        assert.deepEqual(calls(), ["g:1"]);
        assert.equal(
            logs.some((line) => line.includes("secret")),
            false,
        );
        assert.equal(logs.filter((line) => line.includes("commit listener")).length, 2);
    });

    void it("gives a version that loads later the newest view of each session first", async () => {
        const seen = (tag: string): string => listening(tag);

        await write("alpha", seen("a1:"));
        await extensions.load();
        extensions.publish({ ...VIEW, session: { id: 1, cwd: null } });
        extensions.publish({ ...VIEW, session: { id: 2, cwd: null } });
        await write("alpha", seen("a2:"));
        await extensions.load();
        await new Promise((done) => setImmediate(done));

        assert.deepEqual(calls(), ["a1:1", "a1:2", "a2:1", "a2:2"]);
    });
});
