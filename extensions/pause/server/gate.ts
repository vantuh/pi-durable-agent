/**
 * One conversation's pause gate: the hooks park in `hold()`, a resume or an abort lets them go.
 * Nothing here is stored: a pause lives as long as the process, and a restart resumes the work.
 */

/** What a parked call takes from its context: the abort that ends the wait. */
type Cancel = { readonly abortSignal: AbortSignal | undefined };

export class Gate {
    #paused = false;
    readonly #parked = new Set<() => void>();

    get paused(): boolean {
        return this.#paused;
    }

    pause(): void {
        this.#paused = true;
    }

    /** Opens the gate and lets every parked call through. */
    resume(): void {
        const parked = [...this.#parked];
        this.#parked.clear();
        this.#paused = false;

        for (const release of parked) {
            release();
        }
    }

    /** Resolves once the gate is open: at once when it already is, and on abort while parked. */
    async hold(context: Cancel): Promise<void> {
        while (this.#paused) {
            const signal = context.abortSignal;

            if (signal?.aborted === true) {
                return;
            }

            await new Promise<void>((resolve) => {
                const release = (): void => {
                    this.#parked.delete(release);
                    signal?.removeEventListener("abort", release);
                    resolve();
                };

                this.#parked.add(release);
                signal?.addEventListener("abort", release, { once: true });
            });
        }
    }
}
