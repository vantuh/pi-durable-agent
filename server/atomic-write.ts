/**
 * One file, replaced in one step: a temporary file beside it under a name no other write uses, renamed
 * over it. Extension stores write their JSON through here, so one process writes one file at a time.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type WriteOptions = {
    /** The mode the replaced file keeps; without it a new file gets the default mode. */
    mode?: number;
};

/**
 * The writes in flight, per file. The core is loaded once, so every version of every extension shares
 * this map: a reloaded store waits for the write its old version started.
 */
const queues = new Map<string, Promise<unknown>>();

export async function writeFileAtomic(
    file: string,
    text: string,
    options: WriteOptions = {},
): Promise<void> {
    const target = resolve(file);
    const run = (queues.get(target) ?? Promise.resolve()).then(() =>
        writeNow(target, text, options),
    );
    const tail = run.catch(() => undefined);

    queues.set(target, tail);
    // Only the last write may drop the entry; a later one has replaced it by then.
    void tail.then(() => {
        if (queues.get(target) === tail) {
            queues.delete(target);
        }

        return undefined;
    });

    return run;
}

/** The same, for a value written as one line of JSON and a newline, the way the stores keep their files. */
export function writeJsonFile(
    file: string,
    value: unknown,
    options: WriteOptions = {},
): Promise<void> {
    return writeFileAtomic(file, `${JSON.stringify(value)}\n`, options);
}

async function writeNow(file: string, text: string, options: WriteOptions): Promise<void> {
    const folder = dirname(file);
    const temporary = join(folder, `.${basename(file)}.${String(process.pid)}.${randomUUID()}.tmp`);

    await mkdir(folder, { recursive: true });

    try {
        await writeFile(temporary, text, { mode: options.mode });

        if (options.mode !== undefined) {
            // A fresh file takes the umask too, and push.json keeps its 0600 whatever the umask is.
            await chmod(temporary, options.mode);
        }

        await rename(temporary, file);
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);

        throw error;
    }
}
