import { wait } from "./wait.ts";

/** Where loading stood at one moment: how many loads had started and stopped. */
export type LoadMark = { starts: number; stops: number };

/** Whether the page is loading, and who is waiting for a load to stop. */
export class LoadTracker {
    #loading = false;
    #starts = 0;
    #stops = 0;
    readonly #stopWaiters = new Set<() => void>();

    get loading(): boolean {
        return this.#loading;
    }

    started(): void {
        this.#starts++;
        this.#loading = true;
    }

    stopped(): void {
        this.#loading = false;
        this.#stops++;

        for (const wake of this.#stopWaiters) {
            wake();
        }

        this.#stopWaiters.clear();
    }

    crashed(): void {
        this.#loading = false;
    }

    /** Where loading stands before an action, to tell the loads it started from those already going on. */
    mark(): LoadMark {
        return { starts: this.#starts, stops: this.#stops };
    }

    /**
     * Wait for the load an action started, until it stops; false when that took longer than `timeoutMs`. A load that was
     * going on before (a request that never ends) does not count. With `started`, the action surely started one.
     */
    async settle(
        mark: LoadMark,
        timeoutMs: number,
        signal?: AbortSignal,
        started = false,
    ): Promise<boolean> {
        if (!started) {
            // A navigation a click starts begins a moment later.
            await wait(150);

            if (this.#starts === mark.starts) {
                return true;
            }
        }

        if (this.#stops > mark.stops && !this.#loading) {
            return true;
        }

        return new Promise((done) => {
            const finish = (ok: boolean) => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", stop);
                this.#stopWaiters.delete(wake);
                done(ok);
            };

            const wake = () => finish(true);
            const stop = () => finish(false);
            const timer = setTimeout(stop, timeoutMs);

            signal?.addEventListener("abort", stop, { once: true });
            this.#stopWaiters.add(wake);
        });
    }

    /** Wakes whoever waits, so a closed page holds nobody. */
    release(): void {
        for (const wake of this.#stopWaiters) {
            wake();
        }
    }
}
