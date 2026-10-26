import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DeviceSubscription } from "./refs.ts";

export type Vapid = { publicKey: string; privateKey: string };

export type PushFile = {
    version: 1;
    contact: string | null;
    vapid: Vapid | null;
    subscriptions: DeviceSubscription[];
    /** Per conversation, the last entry whose turn is accounted for. Never any content. */
    seen: Record<string, number>;
};

const EMPTY: PushFile = { version: 1, contact: null, vapid: null, subscriptions: [], seen: {} };

/** Conversations remembered in `seen`; the oldest are forgotten past this. */
const MAX_SEEN = 200;

/**
 * Changes to one file run one after another across every instance in the process. A reload makes a
 * new store while the old one may still be working, and the actions and the listener each hold one.
 * An entry lives only while a change is in flight.
 */
const QUEUES = Symbol.for("pi-durable-agent.push.queues");

type Queues = Map<string, Promise<unknown>>;

function isQueues(value: unknown): value is Queues {
    return value instanceof Map;
}

function queues(): Queues {
    const found: unknown = Reflect.get(globalThis, QUEUES);

    if (isQueues(found)) {
        return found;
    }

    const made: Queues = new Map();

    Reflect.set(globalThis, QUEUES, made);

    return made;
}

/** One device per endpoint; a flood of subscriptions must not grow the file without bound. */
const MAX_DEVICES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseFile(text: string): PushFile {
    const raw: unknown = JSON.parse(text);

    if (!isRecord(raw) || raw["version"] !== 1) {
        throw new Error("push.json has an unknown shape");
    }

    const vapid = raw["vapid"];
    const list = raw["subscriptions"];
    const contact = raw["contact"];
    const marks = raw["seen"];
    const seen: Record<string, number> = {};

    for (const [session, id] of Object.entries(isRecord(marks) ? marks : {})) {
        if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) {
            seen[session] = id;
        }
    }

    const subscriptions: DeviceSubscription[] = [];

    for (const item of Array.isArray(list) ? (list as unknown[]) : []) {
        const keys = isRecord(item) ? item["keys"] : undefined;

        if (
            isRecord(item) &&
            typeof item["endpoint"] === "string" &&
            isRecord(keys) &&
            typeof keys["p256dh"] === "string" &&
            typeof keys["auth"] === "string"
        ) {
            subscriptions.push({
                endpoint: item["endpoint"],
                keys: { p256dh: keys["p256dh"], auth: keys["auth"] },
            });
        }
    }

    return {
        version: 1,
        contact: typeof contact === "string" ? contact : null,
        vapid:
            isRecord(vapid) &&
            typeof vapid["publicKey"] === "string" &&
            typeof vapid["privateKey"] === "string"
                ? { publicKey: vapid["publicKey"], privateKey: vapid["privateKey"] }
                : null,
        subscriptions,
        seen,
    };
}

/**
 * The keys, contact and subscriptions in `push.json` of the data directory. Nothing is kept in
 * memory: each read looks at the file, and changes run one after another, so a reload of the
 * extension never works from stale data. A file that cannot be read is an error, never replaced:
 * that would lose every subscription.
 */
export class PushStore {
    readonly #file: string;
    readonly #dir: string;

    constructor(dataDir: string) {
        this.#dir = dataDir;
        this.#file = join(dataDir, "push.json");
    }

    async read(): Promise<PushFile> {
        try {
            return parseFile(await readFile(this.#file, "utf8"));
        } catch (error) {
            if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
                return EMPTY;
            }

            throw new Error("push.json cannot be read", { cause: error });
        }
    }

    /**
     * Runs `change` on the current file and saves the result; a `null` file saves nothing. Changes
     * never overlap, even between stores of one file.
     */
    update<T>(change: (file: PushFile) => { file: PushFile | null; result: T }): Promise<T> {
        const all = queues();
        const run = (all.get(this.#file) ?? Promise.resolve()).then(async () => {
            const { file, result } = change(await this.read());

            if (file !== null) {
                await this.#write(file);
            }

            return result;
        });

        const tail = run.catch(() => undefined);

        all.set(this.#file, tail);
        // Only the last change may remove the entry; a later change has replaced it by then.
        void tail.then(() => {
            if (all.get(this.#file) === tail) {
                all.delete(this.#file);
            }

            return undefined;
        });

        return run;
    }

    async #write(file: PushFile): Promise<void> {
        const temp = `${this.#file}.tmp`;

        await mkdir(this.#dir, { recursive: true });
        await writeFile(temp, JSON.stringify(file), { mode: 0o600 });
        await chmod(temp, 0o600);
        await rename(temp, this.#file);
    }
}

/** Adds a device, or replaces the one with the same endpoint. The oldest goes past the limit. */
export function withSubscription(file: PushFile, subscription: DeviceSubscription): PushFile {
    const others = file.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);

    return { ...file, subscriptions: [...others, subscription].slice(-MAX_DEVICES) };
}

export function withoutEndpoints(file: PushFile, gone: ReadonlySet<string>): PushFile {
    return {
        ...file,
        subscriptions: file.subscriptions.filter((item) => !gone.has(item.endpoint)),
    };
}

/** Remembers the settled point of a conversation; the oldest conversations go past the limit. */
export function withSeen(file: PushFile, session: number, settled: number): PushFile {
    const rest = Object.entries(file.seen).filter(([key]) => key !== String(session));

    return {
        ...file,
        seen: Object.fromEntries([...rest, [String(session), settled]].slice(-MAX_SEEN)),
    };
}
