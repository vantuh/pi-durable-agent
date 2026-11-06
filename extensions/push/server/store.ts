import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { serialize, writeJsonFile } from "../../../server/sdk.ts";
import { isRecord } from "../../../shared/guards.ts";
import type { DeviceSubscription } from "../refs.ts";

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

/** One device per endpoint; a flood of subscriptions must not grow the file without bound. */
const MAX_DEVICES = 20;

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

    constructor(dataDir: string) {
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
        return serialize(this.#file, async () => {
            const { file, result } = change(await this.read());

            if (file !== null) {
                await writeJsonFile(this.#file, file, { mode: 0o600 });
            }

            return result;
        });
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
