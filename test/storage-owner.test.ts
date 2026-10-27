import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { listen } from "../server/lifecycle.ts";

const MAIN = join(import.meta.dirname, "../server/main.ts");
const roots: string[] = [];

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

/** A folder to run in: no extensions, no logins (HOME), no data of ours. */
async function sandbox(): Promise<{ root: string; cwd: string; data: string }> {
    const root = await mkdtemp(join(tmpdir(), "storage-owner-"));

    roots.push(root);
    await mkdir(join(root, "cwd", "extensions"), { recursive: true });

    return { root, cwd: join(root, "cwd"), data: join(root, "data") };
}

type Server = {
    port: number;
    child: ChildProcess;
    ready: Promise<boolean>;
    exited: Promise<number | null>;
    output: () => string;
};

/** `ready` is false when the process ended without announcing itself. */
function start(
    box: { cwd: string; root: string },
    data: string,
    port: number,
    temp: string | undefined,
): Server {
    const child = spawn(process.execPath, [MAIN], {
        cwd: box.cwd,
        env: {
            PATH: process.env["PATH"] ?? "",
            ...((temp ?? process.env["TMPDIR"]) === undefined
                ? {}
                : { TMPDIR: temp ?? process.env["TMPDIR"] }),
            HOME: box.root,
            PORT: String(port),
            PI_DURABLE_DATA_DIR: data,
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

            if (output.includes(`http://127.0.0.1:${String(port)}`)) {
                done(true);
            }
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", () => {
            done(false);
        });
    });

    return { port, child, ready, exited, output: () => output };
}

const running: ChildProcess[] = [];

async function started(
    box: { cwd: string; root: string },
    data: string,
    port?: number,
    temp?: string,
): Promise<Server> {
    const server = start(box, data, port ?? (await freePort()), temp);

    running.push(server.child);

    return server;
}

async function stopped(server: Server): Promise<number | null> {
    server.child.kill("SIGTERM");

    return await server.exited;
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("storage ownership across processes", () => {
    void it("refuses a second server on the same folder before it writes anything", async () => {
        const box = await sandbox();
        const first = await started(box, box.data);

        assert.ok(await first.ready, first.output());
        // The first thing a booting server writes into the folder is `uploads`.
        await rm(join(box.data, "uploads"), { recursive: true });

        const before = (await readdir(box.data)).toSorted();
        const second = await started(box, box.data);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /state\.sqlite is in use by another server/);
        assert.deepEqual((await readdir(box.data)).toSorted(), before);

        assert.equal(
            (await fetch(`http://127.0.0.1:${String(first.port)}/api/health`)).status,
            200,
        );
        assert.equal(await stopped(first), 0);
    });

    void it("meets the same owner through a symlinked folder", async () => {
        const box = await sandbox();
        const link = join(box.root, "alias");
        const first = await started(box, box.data);

        assert.ok(await first.ready, first.output());
        await symlink(box.data, link);
        await rm(join(box.data, "uploads"), { recursive: true });

        const before = (await readdir(box.data)).toSorted();
        const second = await started(box, link);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /in use by another server/);
        assert.deepEqual((await readdir(box.data)).toSorted(), before);
        assert.equal(await stopped(first), 0);
    });

    void it("meets the same owner when TMPDIR differs", async () => {
        const box = await sandbox();
        const elsewhere = join(box.root, "elsewhere");
        const first = await started(box, box.data);

        await mkdir(elsewhere);
        assert.ok(await first.ready, first.output());

        const second = await started(box, box.data, undefined, elsewhere);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /in use by another server/);
        assert.equal(await stopped(first), 0);
    });

    void it("lets exactly one of several servers own the folder after the owner was killed", async () => {
        const box = await sandbox();
        const first = await started(box, box.data);

        assert.ok(await first.ready, first.output());
        first.child.kill("SIGKILL");
        await first.exited;

        const contenders = await Promise.all([
            started(box, box.data),
            started(box, box.data),
            started(box, box.data),
            started(box, box.data),
        ]);
        const outcomes = await Promise.all(contenders.map((server) => server.ready));
        const winners = contenders.filter((_server, at) => outcomes[at] === true);

        assert.equal(winners.length, 1);

        for (const server of contenders) {
            if (!winners.includes(server)) {
                assert.equal(await server.exited, 1);
                assert.match(server.output(), /in use by another server/);
            }
        }

        for (const server of winners) {
            assert.equal(await stopped(server), 0);
        }
    });

    void it("does not touch storage when the port is taken, and keeps no lock afterwards", async () => {
        const box = await sandbox();
        const taken = createNetServer();

        await new Promise<void>((done) => {
            taken.listen(0, "127.0.0.1", done);
        });

        const address = taken.address();

        assert.ok(address !== null && typeof address !== "string");

        try {
            const blocked = await started(box, box.data, address.port);

            assert.equal(await blocked.exited, 1);
            assert.match(blocked.output(), /EADDRINUSE/);
            // The owner file is the only thing a server may leave before it holds the port.
            assert.deepEqual(await readdir(box.data), ["state.sqlite.owner.sqlite"]);
        } finally {
            taken.close();
        }

        const next = await started(box, box.data);

        assert.ok(await next.ready, next.output());
        assert.equal(await stopped(next), 0);
    });

    void it("lets the next server start after a graceful stop", async () => {
        const box = await sandbox();
        const first = await started(box, box.data);

        assert.ok(await first.ready, first.output());
        assert.equal(await stopped(first), 0);

        const second = await started(box, box.data);

        assert.ok(await second.ready, second.output());
        assert.equal(await stopped(second), 0);
    });

    void it("lets the next server start after a failed start", async () => {
        const box = await sandbox();

        await mkdir(box.data);
        await writeFile(join(box.data, "state.sqlite"), "this is not a database");

        const failed = await started(box, box.data);

        assert.equal(await failed.exited, 1);
        assert.doesNotMatch(failed.output(), /in use by another server/);
        await rm(join(box.data, "state.sqlite"));

        const next = await started(box, box.data);

        assert.ok(await next.ready, next.output());
        assert.equal(await stopped(next), 0);
    });

    void it("lets the next server start after the owner was killed", async () => {
        const box = await sandbox();
        const first = await started(box, box.data);

        assert.ok(await first.ready, first.output());
        first.child.kill("SIGKILL");
        await first.exited;

        const second = await started(box, box.data);

        assert.ok(await second.ready, second.output());
        assert.equal(await stopped(second), 0);
    });
});

void describe("listen", () => {
    void it("resets connections until ready, then hands requests on", async () => {
        const box = await sandbox();
        const port = await freePort();
        const lifecycle = await listen({
            dataDir: box.data,
            port,
            handle: async (_request, response) => {
                response.end("handled");
                await Promise.resolve();
            },
        });
        const url = `http://127.0.0.1:${String(port)}/`;

        await assert.rejects(fetch(url), TypeError);
        lifecycle.ready();
        assert.equal(await (await fetch(url)).text(), "handled");
        await lifecycle.stop();
    });

    void it("holds the lock while closing and lets go afterwards", async () => {
        const box = await sandbox();
        const lifecycle = await listen({
            dataDir: box.data,
            port: await freePort(),
            handle: () => Promise.resolve(),
        });
        const events: string[] = [];

        lifecycle.onStop(async () => {
            await assert.rejects(
                listen({
                    dataDir: box.data,
                    port: await freePort(),
                    handle: () => Promise.resolve(),
                }),
                /in use by another server/,
            );
            events.push("first closed");
        });
        lifecycle.onStop(() => {
            events.push("second closed");

            return Promise.resolve();
        });
        await lifecycle.stop();
        assert.deepEqual(events, ["first closed", "second closed"]);

        const next = await listen({
            dataDir: box.data,
            port: await freePort(),
            handle: () => Promise.resolve(),
        });

        await next.stop();
    });
});
