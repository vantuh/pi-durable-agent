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
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

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

        for (let attempt = 0; attempt < 100 && !history.includes("bash said"); attempt += 1) {
            await delay(100);
            history = await (await fetch(`${base}/api/history?session=${String(session)}`)).text();
        }

        assert.match(history, /bash said 42, exit 0/, output());
    });
});
