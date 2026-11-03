/**
 * Reading a JSON file a store keeps. The write side is `atomic-write.ts`, beside this file: a store
 * writes through `writeJsonFile` and reads through `readJsonFile`, so both agree on what an empty
 * store is.
 */
import { readFile } from "node:fs/promises";

/**
 * The value in `file`, or `undefined` when there is nothing to read: no file, or one that does not
 * hold JSON. The stores treat both as "nothing saved yet" and check the shape themselves. Anything
 * else is thrown, because a folder in the file's place is a mistake, not an empty store.
 */
export async function readJsonFile(file: string): Promise<unknown> {
    let text: string;

    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
            return undefined;
        }

        throw error;
    }

    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
