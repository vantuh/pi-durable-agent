/**
 * Work on one key, one piece after another. A store that reads a file and then writes it runs its
 * changes through here under the file's path, so two changes made at once cannot both read the old
 * file and the later write cannot drop the earlier change. `writeFileAtomic` queues the write alone;
 * a change has to hold the read as well.
 */

/**
 * The work in flight, per key, on `globalThis`: a reload imports this file again, and the new copy
 * must wait for what the old one started.
 */
const QUEUES = Symbol.for("pi-durable-agent.keyed-queue");

type Queues = Map<string, Promise<unknown>>;

function queues(): Queues {
    const found: unknown = Reflect.get(globalThis, QUEUES);

    if (found instanceof Map) {
        return found;
    }

    const made: Queues = new Map();

    Reflect.set(globalThis, QUEUES, made);

    return made;
}

/**
 * Runs `work` once the earlier work for `key` has settled, whether it resolved or rejected, and gives
 * back its result. The work must not call this again for the same key: it would wait for itself.
 */
export function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const all = queues();
    const run = (all.get(key) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => undefined);

    all.set(key, tail);
    // Only the last piece of work may drop the entry; a later one has replaced it by then.
    void tail.then(() => {
        if (all.get(key) === tail) {
            all.delete(key);
        }

        return undefined;
    });

    return run;
}
