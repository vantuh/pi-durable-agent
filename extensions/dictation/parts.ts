/**
 * The audio a recording arrives in: one part per request, numbered from zero, joined back in that
 * number order. Ported from Pi Pocket's `local-dictation/server.ts` (MIT).
 */

import { HttpError } from "./http.ts";

/** A recording the browser never finished sending is dropped after this long. */
const STALE_MS = 10 * 60_000;

/** Past this, memory is the risk, not the model. */
export const MAX_BYTES = 32 * 1024 * 1024;

/** The parts of one recording that the browser sent, by part number, while it records. */
type Recording = {
    chunks: Map<number, Buffer>;
    bytes: number;
    at: number;
};

/** Raw little-endian 16-bit PCM as the float samples the model takes. */
export function toSamples(pcm: Buffer): Float32Array {
    const samples = new Float32Array(pcm.length >> 1);

    for (let at = 0; at < samples.length; at++) {
        samples[at] = pcm.readInt16LE(at * 2) / 32768;
    }

    return samples;
}

export class Parts {
    readonly #recordings = new Map<string, Recording>();

    /** Keeps one part and answers the recording's size in bytes; a recording past the cap is dropped. */
    add(id: string, seq: number, pcm: Buffer, now: number): number {
        for (const [each, recording] of this.#recordings) {
            if (now - recording.at > STALE_MS) {
                this.#recordings.delete(each);
            }
        }

        const found = this.#recordings.get(id) ?? {
            chunks: new Map<number, Buffer>(),
            bytes: 0,
            at: now,
        };
        const before = found.chunks.get(seq)?.length ?? 0;

        found.chunks.set(seq, pcm);
        found.bytes += pcm.length - before;
        found.at = now;

        if (found.bytes > MAX_BYTES) {
            this.#recordings.delete(id);

            throw new HttpError(413, "That recording is too long.");
        }

        this.#recordings.set(id, found);

        return found.bytes;
    }

    /** The whole recording in part order, forgotten afterwards: a retry must send it again. */
    take(id: string): Buffer | undefined {
        const found = this.#recordings.get(id);

        this.#recordings.delete(id);

        if (found === undefined) {
            return undefined;
        }

        return Buffer.concat(
            [...found.chunks.entries()].sort(([a], [b]) => a - b).map(([, part]) => part),
        );
    }

    clear(): void {
        this.#recordings.clear();
    }
}
