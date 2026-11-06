import type { Json } from "./cdp.ts";
import type { Send } from "./send.ts";
import type { Viewport } from "./viewport.ts";

export type Frame = { seq: number; data: Buffer; width: number; height: number };

/** Frame numbers, for every page: a page opened again goes on from where the last one was. */
let frameCount = 0;
/** At most one screencast frame per this many milliseconds. */
const FRAME_GAP_MS = 40;
/** Frames stop this long after the last viewer asked for one. */
const WATCH_MS = 15_000;
const FRAME_WAIT_MS = 25_000;

/** The page's screencast for the Browser panel: frames come while someone watches, and stop a while after. */
export class Screencast {
    readonly #send: Send;
    readonly #viewport: () => Viewport;
    readonly #closed: () => boolean;
    #frame: Frame | undefined;
    readonly #frameWaiters = new Set<() => void>();
    #watchers = 0;
    #watchedAt = 0;
    #casting = false;
    #castTimer: NodeJS.Timeout | undefined;

    constructor(options: { send: Send; viewport: () => Viewport; closed: () => boolean }) {
        this.#send = options.send;
        this.#viewport = options.viewport;
        this.#closed = options.closed;
    }

    onFrame(params: Json): void {
        const meta = params.metadata ?? {};

        this.#frame = {
            seq: ++frameCount,
            data: Buffer.from(String(params.data ?? ""), "base64"),
            width: Math.round(meta.deviceWidth ?? this.#viewport().width),
            height: Math.round(meta.deviceHeight ?? this.#viewport().height),
        };

        for (const wake of this.#frameWaiters) {
            wake();
        }

        this.#frameWaiters.clear();
        // The next frame comes after this one is acknowledged: acknowledging a little later caps the frame rate.
        const timer = setTimeout(() => {
            if (this.#casting) {
                void this.#send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(
                    () => {},
                );
            }
        }, FRAME_GAP_MS);

        timer.unref();
    }

    async #startCast(): Promise<void> {
        if (this.#casting || this.#closed()) {
            return;
        }

        this.#casting = true;
        const scale = Math.min(this.#viewport().scale, 2);

        try {
            await this.#send("Page.startScreencast", {
                format: "jpeg",
                quality: 65,
                maxWidth: Math.round(this.#viewport().width * scale),
                maxHeight: Math.round(this.#viewport().height * scale),
            });
        } catch {
            this.#casting = false;

            return;
        }

        clearInterval(this.#castTimer);
        this.#castTimer = setInterval(() => {
            if (this.#watchers === 0 && Date.now() - this.#watchedAt > WATCH_MS) {
                void this.#stopCast();
            }
        }, 5000);
        this.#castTimer.unref();
    }

    async #stopCast(): Promise<void> {
        clearInterval(this.#castTimer);
        this.#castTimer = undefined;

        if (!this.#casting) {
            return;
        }

        this.#casting = false;
        await this.#send("Page.stopScreencast").catch(() => {});
    }

    /** The newest frame after `after`, waiting for one up to 25 seconds; undefined if none came. */
    async frame(after: number, signal?: AbortSignal): Promise<Frame | undefined> {
        // A number from before a restart: this tab has none of these frames.
        const since = after > frameCount ? 0 : after;

        this.#watchedAt = Date.now();
        this.#watchers++;

        try {
            await this.#startCast();

            if (this.#frame !== undefined && this.#frame.seq > since) {
                return this.#frame;
            }

            if (this.#closed()) {
                return undefined;
            }

            await new Promise<void>((done) => {
                const finish = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener("abort", finish);
                    this.#frameWaiters.delete(finish);
                    done();
                };

                const timer = setTimeout(finish, FRAME_WAIT_MS);

                signal?.addEventListener("abort", finish, { once: true });
                this.#frameWaiters.add(finish);
            });

            return this.#frame !== undefined && this.#frame.seq > since ? this.#frame : undefined;
        } finally {
            this.#watchers--;
            this.#watchedAt = Date.now();
        }
    }

    /** The viewport changed: a running cast starts again at the new size. */
    async restart(): Promise<void> {
        if (this.#casting) {
            await this.#stopCast();
            await this.#startCast();
        }
    }

    close(): void {
        this.#casting = false;
        clearInterval(this.#castTimer);

        for (const wake of this.#frameWaiters) {
            wake();
        }
    }
}
