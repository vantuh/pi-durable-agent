import assert from "node:assert/strict";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { listen } from "../server/lifecycle.ts";
import {
    cleanUp,
    freePort,
    sandbox,
    spawnServer,
    type Running,
    type Sandbox,
} from "./fixtures/server.ts";

/** `ready` is false when the process ended without announcing itself. */
async function started(box: Sandbox, data: string, port?: number, temp?: string): Promise<Running> {
    const tmp = temp ?? process.env["TMPDIR"];

    return spawnServer(box, {
        port: port ?? (await freePort()),
        dataDir: data,
        ...(tmp === undefined ? {} : { env: { TMPDIR: tmp } }),
    });
}

async function stopped(server: Running): Promise<number | null> {
    server.child.kill("SIGTERM");

    return await server.exited;
}

after(cleanUp);

void describe("storage ownership across processes", () => {
    void it("refuses a second server on the same folder before it writes anything", async () => {
        const box = await sandbox("storage-owner");
        const first = await started(box, box.dataDir);

        assert.ok(await first.ready, first.output());
        // The first thing a booting server writes into the folder is `uploads`.
        await rm(join(box.dataDir, "uploads"), { recursive: true });

        const before = (await readdir(box.dataDir)).toSorted();
        const second = await started(box, box.dataDir);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /state\.sqlite is in use by another server/);
        assert.deepEqual((await readdir(box.dataDir)).toSorted(), before);

        assert.equal(
            (await fetch(`http://127.0.0.1:${String(first.port)}/api/health`)).status,
            200,
        );
        assert.equal(await stopped(first), 0);
    });

    void it("meets the same owner through a symlinked folder", async () => {
        const box = await sandbox("storage-owner");
        const link = join(box.root, "alias");
        const first = await started(box, box.dataDir);

        assert.ok(await first.ready, first.output());
        await symlink(box.dataDir, link);
        await rm(join(box.dataDir, "uploads"), { recursive: true });

        const before = (await readdir(box.dataDir)).toSorted();
        const second = await started(box, link);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /in use by another server/);
        assert.deepEqual((await readdir(box.dataDir)).toSorted(), before);
        assert.equal(await stopped(first), 0);
    });

    void it("meets the same owner when TMPDIR differs", async () => {
        const box = await sandbox("storage-owner");
        const elsewhere = join(box.root, "elsewhere");
        const first = await started(box, box.dataDir);

        await mkdir(elsewhere);
        assert.ok(await first.ready, first.output());

        const second = await started(box, box.dataDir, undefined, elsewhere);

        assert.equal(await second.exited, 1);
        assert.match(second.output(), /in use by another server/);
        assert.equal(await stopped(first), 0);
    });

    void it("lets exactly one of several servers own the folder after the owner was killed", async () => {
        const box = await sandbox("storage-owner");
        const first = await started(box, box.dataDir);

        assert.ok(await first.ready, first.output());
        first.child.kill("SIGKILL");
        await first.exited;

        const contenders = await Promise.all([
            started(box, box.dataDir),
            started(box, box.dataDir),
            started(box, box.dataDir),
            started(box, box.dataDir),
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
        const box = await sandbox("storage-owner");
        const taken = createNetServer();

        await new Promise<void>((done) => {
            taken.listen(0, "127.0.0.1", done);
        });

        const address = taken.address();

        assert.ok(address !== null && typeof address !== "string");

        try {
            const blocked = await started(box, box.dataDir, address.port);

            assert.equal(await blocked.exited, 1);
            assert.match(blocked.output(), /EADDRINUSE/);
            // The owner file is the only thing a server may leave before it holds the port.
            assert.deepEqual(await readdir(box.dataDir), ["state.sqlite.owner.sqlite"]);
        } finally {
            taken.close();
        }

        const next = await started(box, box.dataDir);

        assert.ok(await next.ready, next.output());
        assert.equal(await stopped(next), 0);
    });

    void it("lets the next server start after a graceful stop", async () => {
        const box = await sandbox("storage-owner");
        const first = await started(box, box.dataDir);

        assert.ok(await first.ready, first.output());
        assert.equal(await stopped(first), 0);

        const second = await started(box, box.dataDir);

        assert.ok(await second.ready, second.output());
        assert.equal(await stopped(second), 0);
    });

    void it("lets the next server start after a failed start", async () => {
        const box = await sandbox("storage-owner");

        await mkdir(box.dataDir);
        await writeFile(join(box.dataDir, "state.sqlite"), "this is not a database");

        const failed = await started(box, box.dataDir);

        assert.equal(await failed.exited, 1);
        assert.doesNotMatch(failed.output(), /in use by another server/);
        await rm(join(box.dataDir, "state.sqlite"));

        const next = await started(box, box.dataDir);

        assert.ok(await next.ready, next.output());
        assert.equal(await stopped(next), 0);
    });

    void it("lets the next server start after the owner was killed", async () => {
        const box = await sandbox("storage-owner");
        const first = await started(box, box.dataDir);

        assert.ok(await first.ready, first.output());
        first.child.kill("SIGKILL");
        await first.exited;

        const second = await started(box, box.dataDir);

        assert.ok(await second.ready, second.output());
        assert.equal(await stopped(second), 0);
    });
});

void describe("listen", () => {
    void it("resets connections until ready, then hands requests on", async () => {
        const box = await sandbox("storage-owner");
        const port = await freePort();
        const lifecycle = await listen({
            dataDir: box.dataDir,
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
        const box = await sandbox("storage-owner");
        const lifecycle = await listen({
            dataDir: box.dataDir,
            port: await freePort(),
            handle: () => Promise.resolve(),
        });
        const events: string[] = [];

        lifecycle.onStop(async () => {
            await assert.rejects(
                listen({
                    dataDir: box.dataDir,
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
            dataDir: box.dataDir,
            port: await freePort(),
            handle: () => Promise.resolve(),
        });

        await next.stop();
    });
});
