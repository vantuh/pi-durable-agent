import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { Host, SessionGoneListener } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { type Output, create, list, open, read } from "./refs.ts";
import { actions, tail } from "./server.ts";

/** The fields this extension reads; the rest of the host is nothing it touches. */
function hostOf(dataDir: string): {
    host: Host;
    stop: () => Promise<void>;
    gone: (session: number) => void;
} {
    const disposers: (() => void | Promise<void>)[] = [];
    const listeners: SessionGoneListener[] = [];

    return {
        host: testHost({
            name: "terminal",
            cwd: dataDir,
            dataDir,
            onDispose: (dispose) => disposers.push(dispose),
            onSessionGone: (listener) => {
                listeners.push(listener);
            },
        }),
        /** What the server does when the extension goes or reloads: run what it registered. */
        stop: async () => {
            for (const dispose of disposers.reverse()) {
                await dispose();
            }
        },
        /** What the core does when a session is deleted. */
        gone: (session) => {
            for (const listener of listeners) {
                void listener(session);
            }
        },
    };
}

void describe("terminal", () => {
    let dir: string;
    let started: ReturnType<typeof hostOf>;
    let run: ReturnType<typeof actions>;

    /** The tab the shell helpers below talk to. */
    let tab = 0;

    const as = async (
        session: { id: number; cwd: string },
        name: string,
        args: unknown,
    ): Promise<unknown> => {
        const action = run[name];

        assert.ok(action, `the extension has an action named ${name}`);

        return await action({ args, session });
    };

    const call = async (name: string, args: unknown): Promise<unknown> =>
        await as({ id: 7, cwd: dir }, name, args === undefined ? { tab } : { tab, ...args });

    /** A new tab, attached at 80 by 24. */
    const start = async (): Promise<Output> => {
        tab = create.parse(await as({ id: 7, cwd: dir }, "create", undefined));

        return open.parse(await call("open", { cols: 80, rows: 24 }));
    };

    /** Polls until `pid` is gone; fails, killing its group, when it outlives two seconds and more. */
    const gone = async (pid: number, what: string): Promise<void> => {
        for (let tries = 0; tries < 60; tries += 1) {
            try {
                process.kill(pid, 0);
            } catch {
                return;
            }

            await new Promise((done) => {
                setTimeout(done, 100);
            });
        }

        // Nothing may outlive the test, or the runner waits on the pty: end what the test found alive.
        process.kill(-pid, "SIGKILL");
        assert.fail(`the shell ${String(pid)} outlived ${what}`);
    };

    /** Reads on until `seen` accepts the output: the shell answers in chunks. */
    const until = async (from: Output, seen: (output: Output) => boolean): Promise<Output> => {
        let output = from;

        for (let tries = 0; tries < 20 && !seen(output); tries += 1) {
            const next = read.parse(await call("read", { after: output.seq }));

            if (next !== null) {
                output = next;
            }
        }

        return output;
    };

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), "terminal-test-"));
        started = hostOf(dir);
        run = actions(started.host);
    });

    after(async () => {
        await started.stop();
        await rm(dir, { recursive: true, force: true });
    });

    void it("starts a shell and reads back what it printed", async () => {
        const shell = await start();

        assert.equal(shell.exited, false);

        // The typed line echoes back, so the marker is built by the shell instead of written into it.
        await call("write", { data: "printf 'TERM_%s\\n' OK\n" });

        const output = await until(shell, (seen) => seen.data.includes("TERM_OK"));

        assert.match(output.data, /TERM_OK/);
    });

    void it("answers only what came after `after`", async () => {
        const shell = await start();

        // The marker is the command's output, not its text: the echo of what was typed comes back too.
        await call("write", { data: "printf 'ONE' | rev\n" });
        const first = await until(shell, (seen) => seen.data.includes("ENO"));

        await call("write", { data: "printf 'TWO' | rev\n" });
        const second = await until(first, (seen) => seen.data.includes("OWT"));

        assert.match(second.data, /OWT/);
        assert.doesNotMatch(second.data, /ENO/, "an answer carries the new output only");
    });

    void it("refuses a size that is not a whole number, and args that are not what they claim", async () => {
        await assert.rejects(call("open", { cols: 0, rows: 24 }), /cols and rows/);
        await assert.rejects(call("resize", { cols: 80, rows: 1.5 }), /cols and rows/);
        await assert.rejects(call("write", { data: 42 }), /data must be a string/);
        await assert.rejects(call("read", { after: -1 }), /after must be a whole number/);
        await assert.rejects(call("read", { tab: 0, after: 0 }), /tab must be a whole number/);
        await assert.rejects(call("read", { tab: 9999, after: 0 }), /no shell is running/);
    });

    void it("shows the folder's tabs to every session in it, and not to another folder", async () => {
        const other = await mkdtemp(join(tmpdir(), "terminal-other-"));

        try {
            const shell = await start();
            const neighbour = { id: 8, cwd: dir };

            assert.ok(list.parse(await as(neighbour, "list", undefined)).some((t) => t.id === tab));
            assert.deepEqual(list.parse(await as({ id: 9, cwd: other }, "list", undefined)), []);

            // What the neighbour types, this session reads: one shell, not two.
            await as(neighbour, "write", { tab, data: "printf 'SHARED' | rev\n" });
            const output = await until(shell, (seen) => seen.data.includes("DERAHS"));

            assert.match(output.data, /DERAHS/);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    void it("keeps a stopped tab for a new shell, and drops a removed one", async () => {
        await start();
        await call("close", undefined);

        const stopped = read.parse(await call("read", { after: 0 }));

        assert.equal(stopped?.exited, true);

        const again = open.parse(await call("open", { cols: 80, rows: 24 }));

        assert.equal(again.exited, false, "opening a stopped tab starts a shell in it");

        await call("remove", undefined);
        assert.ok(!list.parse(await call("list", undefined)).some((t) => t.id === tab));
        await assert.rejects(call("read", { after: 0 }), /no shell is running/);
    });

    void it("reports the shell exiting, and opens a new one afterwards", async () => {
        const shell = await start();

        await call("write", { data: "exit\n" });

        const ended = await until(shell, (seen) => seen.exited);

        assert.equal(ended.exited, true);

        const again = await start();

        assert.equal(again.exited, false, "opening after an exit starts a shell of its own");
    });

    void it("kills the shell when its tab closes, and when the version is disposed", async () => {
        await start();
        await call("remove", undefined);
        await assert.rejects(call("read", { after: 0 }), /no shell is running/);

        await start();
        await started.stop();
        await assert.rejects(call("read", { after: 0 }), /no shell is running/);
    });

    void it("ends a shell that ignores the hangup, instead of leaving it behind", async () => {
        const shell = await start();

        await call("write", { data: "trap '' HUP; printf 'PID=%s\\n' $$\n" });

        const printed = await until(shell, (seen) => /PID=\d+/.test(seen.data));
        const pid = Number(/PID=(\d+)/.exec(printed.data)?.[1]);

        assert.ok(pid > 0, `the shell named its pid: ${printed.data}`);

        await call("close", undefined);

        // SIGHUP is ignored, so this only goes once the bound has passed and the group was killed.
        await gone(pid, "the close");
    });

    void it("ends the folder's shells when the last session that used them is deleted", async () => {
        const shell = await start();

        await call("write", { data: "printf 'PID=%s\\n' $$\n" });

        const printed = await until(shell, (seen) => /PID=\d+/.test(seen.data));
        const pid = Number(/PID=(\d+)/.exec(printed.data)?.[1]);

        assert.ok(pid > 0, `the shell named its pid: ${printed.data}`);

        // A neighbour in the same folder keeps the shell alive past this session's deletion.
        const neighbour = { id: 8, cwd: dir };

        await as(neighbour, "list", undefined);
        started.gone(7);

        // Asked as the neighbour: a call from session 7 would make it a user of the folder again.
        const left = list.parse(await as(neighbour, "list", undefined));

        assert.equal(left.find((t) => t.id === tab)?.exited, false);

        started.gone(8);
        await gone(pid, "its sessions");
    });

    void it("cuts the scrollback on a whole character, not inside a surrogate pair", () => {
        assert.equal(tail("abcd", 10), "abcd");
        assert.equal(tail("a😀" + "b".repeat(9), 10), "b".repeat(9));
        assert.equal(tail("😀".repeat(8), 4), "😀".repeat(2));
    });
});
