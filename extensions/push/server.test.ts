import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ActionError, type CommitListener, type CommitView, type Host } from "../../server/sdk.ts";
import { normalizeContact, type DeviceSubscription } from "./refs.ts";
import { finishedPayload, notifyAll, type Transport } from "./send.ts";
import { listen, pushActions } from "./server.ts";
import { type PushFile, PushStore, withSeen } from "./store.ts";

function device(host = "fcm.googleapis.com", id = "a"): DeviceSubscription {
    return {
        endpoint: `https://${host}/send/${id}`,
        keys: {
            p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
        },
    };
}

class PausingStore extends PushStore {
    after: () => Promise<void> = () => Promise.resolve();
    before: () => Promise<void> = () => Promise.resolve();

    override async update<T>(
        change: (file: PushFile) => { file: PushFile | null; result: T },
    ): Promise<T> {
        await this.before();

        const result = await super.update(change);

        await this.after();

        return result;
    }
}

void describe("push", () => {
    let dir: string;
    let store: PushStore;

    const call = (name: string, args: unknown) => {
        const action = pushActions(store)[name];

        assert.ok(action);

        return Promise.resolve(action({ args, session: null }));
    };
    const ready = async () => {
        await call("prepare", { contact: "me@example.com" });
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "push-test-"));
        store = new PushStore(dir);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void describe("contact", () => {
        void it("accepts an email or a public https address", () => {
            assert.equal(normalizeContact(" me@example.com "), "mailto:me@example.com");
            assert.equal(normalizeContact("mailto:me@example.com"), "mailto:me@example.com");
            assert.equal(normalizeContact("https://pi.example.com"), "https://pi.example.com/");
        });

        void it("rejects blank, local and non-https contacts", () => {
            for (const bad of [
                "",
                "  ",
                "me",
                "http://pi.example.com",
                "https://localhost:8788",
                "https://192.168.1.4",
                "https://u:p@pi.example.com",
                5,
            ]) {
                assert.throws(() => normalizeContact(bad), String(bad));
            }
        });

        void it("is checked by the prepare action and makes no keys when bad", async () => {
            await assert.rejects(call("prepare", { contact: "nope" }), ActionError);
            assert.equal((await store.read()).vapid, null);
        });
    });

    void describe("subscription checks", () => {
        void it("saves a valid device only after setup", async () => {
            await assert.rejects(call("subscribe", { subscription: device() }), ActionError);
            await ready();
            await call("subscribe", { subscription: device() });

            assert.equal((await store.read()).subscriptions.length, 1);
        });

        void it("rejects endpoints that are not browser push services", async () => {
            await ready();

            for (const host of [
                "169.254.169.254",
                "localhost",
                "evil.example.com",
                "fcm.googleapis.com.evil.com",
                "updates.push.services.mozilla.com@evil.com",
            ]) {
                await assert.rejects(
                    call("subscribe", { subscription: device(host) }),
                    ActionError,
                    host,
                );
            }

            const http = device();
            const withPort = { ...device(), endpoint: "https://fcm.googleapis.com:8443/x" };
            const withAuth = { ...device(), endpoint: "https://user:pw@fcm.googleapis.com/x" };
            const withHash = { ...device(), endpoint: "https://fcm.googleapis.com/x#y" };

            for (const bad of [
                { ...http, endpoint: "http://fcm.googleapis.com/x" },
                withPort,
                withAuth,
                withHash,
            ]) {
                await assert.rejects(
                    call("subscribe", { subscription: bad }),
                    ActionError,
                    bad.endpoint,
                );
            }

            assert.equal((await store.read()).subscriptions.length, 0);
        });

        void it("accepts the push services of Firefox, Windows and Apple", async () => {
            await ready();

            for (const host of [
                "updates.push.services.mozilla.com",
                "wns2-par02p.notify.windows.com",
                "web.push.apple.com",
            ]) {
                await call("subscribe", { subscription: device(host, host) });
            }

            assert.equal((await store.read()).subscriptions.length, 3);
        });

        void it("rejects keys of the wrong size or encoding", async () => {
            await ready();

            const good = device();
            const shortKey = {
                ...good,
                keys: { ...good.keys, p256dh: randomBytes(64).toString("base64url") },
            };
            const compressed = {
                ...good,
                keys: {
                    ...good.keys,
                    p256dh: Buffer.concat([Buffer.from([2]), randomBytes(64)]).toString(
                        "base64url",
                    ),
                },
            };
            const shortAuth = {
                ...good,
                keys: { ...good.keys, auth: randomBytes(15).toString("base64url") },
            };
            const notUrl = { ...good, keys: { ...good.keys, auth: "!!!!" } };

            for (const bad of [
                shortKey,
                compressed,
                shortAuth,
                notUrl,
                { endpoint: good.endpoint },
                null,
            ]) {
                await assert.rejects(call("subscribe", { subscription: bad }), ActionError);
            }
        });

        void it("unsubscribes only the asked device", async () => {
            await ready();

            const one = device("fcm.googleapis.com", "1");
            const two = device("fcm.googleapis.com", "2");

            await call("subscribe", { subscription: one });
            await call("subscribe", { subscription: two });
            await call("unsubscribe", { endpoint: one.endpoint });

            assert.deepEqual(
                (await store.read()).subscriptions.map((item) => item.endpoint),
                [two.endpoint],
            );
            assert.deepEqual(await call("state", { endpoint: two.endpoint }), {
                contact: "mailto:me@example.com",
                ready: true,
                subscribed: true,
            });
            assert.deepEqual(await call("state", { endpoint: one.endpoint }), {
                contact: "mailto:me@example.com",
                ready: true,
                subscribed: false,
            });
        });
    });

    void describe("persistence", () => {
        void it("writes push.json with mode 0600 and keeps keys and devices for a new store", async () => {
            const first = await call("prepare", { contact: "me@example.com" });

            await call("subscribe", { subscription: device() });

            const mode = (await stat(join(dir, "push.json"))).mode & 0o777;
            const again = await new PushStore(dir).read();

            assert.equal(mode, 0o600);
            assert.deepEqual(first, { publicKey: again.vapid?.publicKey });
            assert.equal(again.subscriptions.length, 1);
        });

        void it("makes keys once and reuses them", async () => {
            const one = await call("prepare", { contact: "me@example.com" });
            const two = await call("prepare", { contact: "https://pi.example.com" });

            assert.deepEqual(one, two);
            assert.equal((await store.read()).contact, "https://pi.example.com/");
        });

        void it("serialises concurrent changes", async () => {
            await ready();
            await Promise.all(
                ["1", "2", "3", "4", "5"].map((id) =>
                    call("subscribe", { subscription: device("fcm.googleapis.com", id) }),
                ),
            );

            assert.equal((await store.read()).subscriptions.length, 5);
        });

        void it("serialises changes between two stores of one file", async () => {
            await ready();
            await Promise.all(
                [1, 2, 3, 4, 5, 6].map((id) =>
                    new PushStore(dir).update((file) => ({
                        file: withSeen(file, id, id),
                        result: null,
                    })),
                ),
            );

            assert.equal(Object.keys((await store.read()).seen).length, 6);
        });

        void it("keeps no queue entry once changes finish, and still serialises later ones", async () => {
            const queues: unknown = Reflect.get(
                globalThis,
                Symbol.for("pi-durable-agent.push.queues"),
            );

            await ready();
            await Promise.all([
                call("prepare", { contact: "a@example.com" }),
                call("prepare", { contact: "b@example.com" }),
            ]);
            await new Promise((resolve) => setImmediate(resolve));

            assert.ok(queues instanceof Map);
            assert.equal(queues.size, 0);

            await call("subscribe", { subscription: device() });

            assert.equal((await store.read()).subscriptions.length, 1);
        });

        void it("does not replace a file it cannot read", async () => {
            await writeFile(join(dir, "push.json"), "{broken");

            await assert.rejects(call("prepare", { contact: "me@example.com" }));
            assert.equal(await readFile(join(dir, "push.json"), "utf8"), "{broken");
        });
    });

    void describe("sending", () => {
        const sent = async (statuses: Record<string, number | Error>) => {
            await ready();

            for (const id of Object.keys(statuses)) {
                await call("subscribe", { subscription: device("fcm.googleapis.com", id) });
            }

            const calls: string[] = [];
            const transport: Transport = (target, payload) => {
                calls.push(`${target.endpoint}|${payload}`);

                const result = statuses[target.endpoint.split("/").pop() ?? ""];

                return result instanceof Error
                    ? Promise.reject(result)
                    : Promise.resolve(result ?? 201);
            };

            await notifyAll(store, transport, finishedPayload(7));

            return {
                calls,
                left: (await store.read()).subscriptions.map(
                    (item) => item.endpoint.split("/").pop() ?? "",
                ),
            };
        };

        void it("removes devices that answer 404 or 410 and keeps the others", async () => {
            const { left, calls } = await sent({
                ok: 201,
                gone: 410,
                missing: 404,
                slow: new Error("timeout"),
                busy: 503,
            });

            assert.equal(calls.length, 5);
            assert.deepEqual(
                left.toSorted((a, b) => a.localeCompare(b)),
                ["busy", "ok", "slow"],
            );
        });

        void it("sends a generic payload with the conversation link", async () => {
            const { calls } = await sent({ one: 201 });
            const payload: unknown = JSON.parse(calls[0]?.split("|")[1] ?? "");

            assert.deepEqual(payload, {
                title: "Pi finished",
                body: "A conversation has a new answer.",
                url: "/?session=7",
                tag: "session-7",
            });
        });

        void it("sends nothing without setup or devices", async () => {
            let count = 0;

            await notifyAll(
                store,
                () => {
                    count += 1;

                    return Promise.resolve(201);
                },
                "{}",
            );
            await ready();
            await notifyAll(
                store,
                () => {
                    count += 1;

                    return Promise.resolve(201);
                },
                "{}",
            );

            assert.equal(count, 0);
        });
    });

    void describe("listener", () => {
        const wire = (using: PushStore = store) => {
            const listeners: CommitListener[] = [];
            const disposers: (() => void | Promise<void>)[] = [];
            const host: Host = {
                name: "push",
                cwd: dir,
                dataDir: dir,
                log: () => undefined,
                onDispose: (dispose) => disposers.push(dispose),
                onCommit: (listener) => listeners.push(listener),
                shapeModelRequests: () => undefined,
                registerModelProvider: () => () => undefined,
                wrapModelFetch: () => undefined,
                resolveModelAuth: () => Promise.resolve(undefined),
                contextWindow: () => undefined,
                sessionRequest: () => Promise.resolve(undefined),
                sessionTitle: () => Promise.resolve(null),
                sessionName: () => Promise.resolve(null),
                setSessionTitle: () => Promise.resolve(),
                setSessionMark: () => undefined,
                notifySessionChanged: () => undefined,
            };
            const sends: string[] = [];

            listen(host, using, (_device, payload) => {
                sends.push(payload);

                return Promise.resolve(201);
            });

            const commit = async (entries: unknown[], busy: boolean) => {
                // Test data: ids are plain numbers here, branded in the real harness.
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion
                const view = {
                    session: { id: 3, cwd: null },
                    entries,
                    busy,
                } as unknown as CommitView;

                await listeners[0]?.(view);
                await new Promise((resolve) => setTimeout(resolve, 60));
            };

            return { sends, commit, disposers };
        };
        const entries = (...kinds: [string, string?][]) =>
            kinds.map(([kind, stop], at) => ({ id: at + 1, kind, model: [{ stopReason: stop }] }));

        void it("sends one push for a finished turn and none for history or errors", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const { sends, commit } = wire();

            await commit(entries(["pi.user"], ["pi.assistant", "stop"]), false);
            assert.equal(sends.length, 0);

            await commit(
                entries(
                    ["pi.user"],
                    ["pi.assistant", "stop"],
                    ["pi.user"],
                    ["pi.assistant", "error"],
                ),
                false,
            );
            assert.equal(sends.length, 0);

            await commit(
                entries(
                    ["pi.user"],
                    ["pi.assistant", "stop"],
                    ["pi.user"],
                    ["pi.assistant", "error"],
                    ["pi.user"],
                    ["pi.assistant", "stop"],
                ),
                false,
            );
            assert.equal(sends.length, 1);
        });

        void it("sends for a turn that ended while the extension reloaded, once", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const old = wire();

            await old.commit(entries(["pi.user"]), false);
            await old.commit(entries(["pi.user"], ["pi.user"]), true);

            // A new version starts: it gets the idle snapshot that holds the final answer.
            const fresh = wire();
            const finished = entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]);

            await fresh.commit(finished, false);
            await fresh.commit(finished, false);

            assert.equal(fresh.sends.length, 1);
            assert.equal(old.sends.length, 0);
        });

        void it("lets only one of two overlapping versions send a turn", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const older = wire();
            const newer = wire();
            const finished = entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]);

            await older.commit(entries(["pi.user"]), false);
            await newer.commit(entries(["pi.user"]), false);
            await Promise.all([older.commit(finished, false), newer.commit(finished, false)]);

            assert.equal(older.sends.length + newer.sends.length, 1);
            assert.equal((await store.read()).seen["3"], 3);
        });

        void it("does not move the saved point back for a late handler", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const older = wire();
            const newer = wire();

            await older.commit(entries(["pi.user"]), false);
            await newer.commit(entries(["pi.user"]), false);
            await newer.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);
            // The old version handles a stale commit after the new one already advanced.
            await older.commit(entries(["pi.user"], ["pi.user"]), true);

            assert.equal((await store.read()).seen["3"], 3);
            assert.equal(older.sends.length, 0);
            assert.equal(newer.sends.length, 1);
        });

        void it("sends a claimed turn once even when its version is disposed right after the claim", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            // A store that runs `after` once the claim is saved and before the send.
            const pausing = new PausingStore(dir);
            const old = wire(pausing);

            await old.commit(entries(["pi.user"]), false);
            pausing.after = async () => {
                for (const run of old.disposers) {
                    await run();
                }
            };
            await old.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);

            const fresh = wire();

            await fresh.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);
            await fresh.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);

            assert.equal(old.sends.length + fresh.sends.length, 1);
            assert.equal(old.sends.length, 1);
        });

        void it("sends exactly once when the save is paused, the version is disposed, and a new one replays", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const pausing = new PausingStore(dir);
            const old = wire(pausing);
            const finished = entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]);

            await old.commit(entries(["pi.user"]), false);

            let release: () => void = () => undefined;

            pausing.before = () =>
                new Promise((resolve) => {
                    release = resolve;
                });

            const paused = old.commit(finished, false);

            for (const run of old.disposers) {
                await run();
            }

            const fresh = wire();

            await fresh.commit(entries(["pi.user"]), false);
            await fresh.commit(finished, false);
            release();
            await paused;

            assert.equal(old.sends.length + fresh.sends.length, 1);
            assert.equal((await store.read()).seen["3"], 3);
        });

        void it("does not claim a turn when its version was disposed before the claim", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const old = wire();

            await old.commit(entries(["pi.user"]), false);
            for (const run of old.disposers) {
                await run();
            }
            await old.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);

            const fresh = wire();

            await fresh.commit(entries(["pi.user"], ["pi.user"], ["pi.assistant", "stop"]), false);

            // Nothing was claimed by the disposed version, so the turn is not lost: the new one sends it.
            assert.equal(old.sends.length, 0);
            assert.equal(fresh.sends.length, 1);
            assert.equal((await store.read()).seen["3"], 3);
        });

        void it("stops sending after its version is disposed", async () => {
            await ready();
            await call("subscribe", { subscription: device() });

            const { sends, commit, disposers } = wire();

            await commit([], false);
            for (const dispose of disposers) {
                await dispose();
            }
            await commit(entries(["pi.user"], ["pi.assistant", "stop"]), false);

            assert.equal(sends.length, 0);
        });
    });
});
