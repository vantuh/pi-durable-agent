// The real server on a free port with a temporary data directory, for tests that go through every
// gate and route. Never the working `data/state.sqlite`.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO = join(import.meta.dirname, "../..");
const MAIN = join(REPO, "server", "main.ts");

/** What `startServer` made and `cleanUp` removes: a test file calls `after(cleanUp)` once. */
const roots: string[] = [];
const running: ChildProcess[] = [];

export async function freePort(): Promise<number> {
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

/** A home folder, with `cwd` below it as the working folder and the server's data folder beside it. */
export type Sandbox = { root: string; cwd: string; dataDir: string };

/** `cwd/extensions` exists and nothing else does: no logins (HOME), no data of ours. */
export async function sandbox(prefix = "server-test"): Promise<Sandbox> {
    const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions"), { recursive: true });

    return { root, cwd, dataDir: join(root, "data") };
}

/** Installs `files` (name in the folder -> absolute path) into `cwd/extensions/<folder>` as symlinks. */
export async function linkExtension(
    box: Sandbox,
    folder: string,
    files: Record<string, string>,
): Promise<void> {
    await mkdir(join(box.cwd, "extensions", folder), { recursive: true });

    for (const [name, source] of Object.entries(files)) {
        await symlink(source, join(box.cwd, "extensions", folder, name));
    }
}

export type Running = {
    port: number;
    base: string;
    child: ChildProcess;
    /** False when the process ended without announcing itself. */
    ready: Promise<boolean>;
    exited: Promise<number | null>;
    output: () => string;
};

/** Starts the server on `box` and returns at once; `ready` says when it listens. */
export function spawnServer(
    box: Sandbox,
    options: { port: number; dataDir?: string; env?: Record<string, string> },
): Running {
    const { port } = options;
    const base = `http://127.0.0.1:${String(port)}`;
    const child = spawn(process.execPath, [MAIN], {
        cwd: box.cwd,
        env: {
            PATH: process.env["PATH"] ?? "",
            HOME: box.root,
            PI_CODING_AGENT_DIR: join(box.root, "agent"),
            PI_DURABLE_DATA_DIR: options.dataDir ?? box.dataDir,
            PORT: String(port),
            ...options.env,
        },
    });
    let output = "";
    const exited = new Promise<number | null>((done) => {
        child.on("exit", (code) => {
            done(code);
        });
    });
    const ready = new Promise<boolean>((done) => {
        const onData = (chunk: Buffer): void => {
            output += chunk.toString();

            if (output.includes(base)) {
                done(true);
            }
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", () => {
            done(false);
        });
    });

    running.push(child);

    return { port, base, child, ready, exited, output: () => output };
}

export type TestServer = {
    base: string;
    /** Its home folder, and `cwd` below it as its working folder: nothing a test writes lands outside `root`. */
    root: string;
    cwd: string;
    output: () => string;
    stop: () => Promise<void>;
};

/**
 * A server on a free port, listening when this returns. It runs in `box`, or in a fresh sandbox when a test
 * has nothing to put there first; `env` adds to what the server is given (`MODEL`, ...).
 */
export async function startServer(
    options: { box?: Sandbox; prefix?: string; env?: Record<string, string> } = {},
): Promise<TestServer> {
    const box = options.box ?? (await sandbox(options.prefix));
    const server = spawnServer(box, {
        port: await freePort(),
        ...(options.env === undefined ? {} : { env: options.env }),
    });

    if (!(await server.ready)) {
        throw new Error(server.output());
    }

    return {
        base: server.base,
        root: box.root,
        cwd: box.cwd,
        output: server.output,
        stop: async () => {
            server.child.kill("SIGKILL");
            await rm(box.root, { recursive: true, force: true });
        },
    };
}

export async function cleanUp(): Promise<void> {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
}
