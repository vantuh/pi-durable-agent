import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createRegistry } from "@earendil-works/pi-durable";

import { Extensions } from "../server/extensions.ts";

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
    let extensions: Extensions;

    async function write(folder: string, text: string): Promise<void> {
        await mkdir(join(dir, folder), { recursive: true });
        await writeFile(join(dir, folder, "server.ts"), text);
    }

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "extensions-test-"));
        dir = join(root, "extensions");
        logs = [];
        await mkdir(dir);
        Reflect.set(globalThis, CALLS, []);
        extensions = new Extensions({
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
});
