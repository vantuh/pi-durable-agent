// The real server on a free port with a temporary data directory, for tests that go through every
// gate and route. Never the working `data/state.sqlite`.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dirname, "../../server/main.ts");

async function freePort(): Promise<number> {
    const probe = createServer();

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

export type TestServer = {
    base: string;
    /** Its home folder, and `cwd` below it as its working folder: nothing a test writes lands outside `root`. */
    root: string;
    cwd: string;
    stop: () => Promise<void>;
};

export async function startServer(): Promise<TestServer> {
    const root = await mkdtemp(join(tmpdir(), "server-test-"));
    const cwd = join(root, "cwd");
    const port = await freePort();

    await mkdir(join(cwd, "extensions"), { recursive: true });

    const child: ChildProcess = spawn(process.execPath, [MAIN], {
        cwd,
        env: {
            PATH: process.env["PATH"] ?? "",
            HOME: root,
            PORT: String(port),
            PI_DURABLE_DATA_DIR: join(root, "data"),
        },
    });
    const base = `http://127.0.0.1:${String(port)}`;
    let output = "";

    await new Promise<void>((done, fail) => {
        const onData = (chunk: Buffer): void => {
            output += chunk.toString();

            if (output.includes(base)) {
                done();
            }
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("exit", () => {
            fail(new Error(output));
        });
    });

    return {
        base,
        root,
        cwd,
        stop: async () => {
            child.kill("SIGKILL");
            await rm(root, { recursive: true, force: true });
        },
    };
}
