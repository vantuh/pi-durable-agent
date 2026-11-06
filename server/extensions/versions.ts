/**
 * The versions of an extension folder: the one that is live, what it must clean up, and the ones that were
 * replaced but still have calls running. Nothing here knows what a version registered; the loader does.
 */

import { messageOf } from "../../shared/guards.ts";
import type { Disposer } from "./contract.ts";

export function newVersion(): Version {
    return { disposers: [], active: 0, finish: undefined };
}

/** One build of a folder: what it must clean up, and how many of its calls are still running. */
export type Version = {
    readonly disposers: Disposer[];
    active: number;
    /** Set while the version is replaced or removed but still has calls running; runs its disposers once and always returns that run. */
    finish: (() => Promise<void>) | undefined;
};

/** Counts a call of a version while it runs, and finishes the version's cleanup when its last call ends. */
export async function track<T>(version: Version, call: () => T | Promise<T>): Promise<T> {
    version.active += 1;
    try {
        return await call();
    } finally {
        version.active -= 1;
        if (version.active === 0) {
            void version.finish?.();
        }
    }
}

export class Versions {
    readonly #log: (message: string) => void;
    /** Per folder, the version that is live now. */
    readonly #live = new Map<string, Version>();
    /** Versions that were replaced or removed and wait for their running calls to end. */
    readonly #draining = new Set<Version>();

    constructor(log: (message: string) => void) {
        this.#log = log;
    }

    /** The folders with a live version. */
    get folders(): string[] {
        return [...this.#live.keys()];
    }

    has(folder: string): boolean {
        return this.#live.has(folder);
    }

    /** Makes `next` the live version of the folder and returns the one it replaced. */
    replace(folder: string, next: Version): Version | undefined {
        const old = this.#live.get(folder);

        this.#live.set(folder, next);

        return old;
    }

    /** Forgets the live version of the folder and returns it. */
    remove(folder: string): Version | undefined {
        const old = this.#live.get(folder);

        this.#live.delete(folder);

        return old;
    }

    /** Runs the disposers of a version now, or when its last running call ends if it has one and `drain`. */
    async retire(folder: string, version: Version | undefined, drain: boolean): Promise<void> {
        if (version === undefined) {
            return;
        }

        if (!drain || version.active === 0) {
            await this.run(folder, version.disposers);

            return;
        }

        let cleanup: Promise<void> | undefined;

        version.finish = () => {
            cleanup ??= this.run(folder, version.disposers).finally(() => {
                this.#draining.delete(version);
            });

            return cleanup;
        };
        this.#draining.add(version);
    }

    /** Finishes every version still draining, whatever it has running. */
    async finish(): Promise<void> {
        for (const version of [...this.#draining]) {
            await version.finish?.();
        }
    }

    /** One that throws or rejects is logged; the rest still run. */
    async run(folder: string, disposers: readonly Disposer[]): Promise<void> {
        for (const dispose of disposers) {
            try {
                await dispose();
            } catch (error) {
                this.#log(`extensions: ${folder}: dispose failed: ${messageOf(error)}`);
            }
        }
    }
}
