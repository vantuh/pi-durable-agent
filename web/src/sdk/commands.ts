import { useEffect, useSyncExternalStore } from "react";

/** What the shell can be told to do from outside it, by name. */
export type ShellCommand =
    | "session.new"
    | "folder.pick"
    | "session.search"
    | "session.rename"
    | "session.prev"
    | "session.next";

const handlers: Partial<Record<ShellCommand, () => void>> = {};

/** The part of the shell that owns `name` calls this with the current handler. */
export function useShellCommand(name: ShellCommand, run: () => void): void {
    useEffect(() => {
        handlers[name] = run;

        return () => {
            if (handlers[name] === run) {
                delete handlers[name];
            }
        };
    });
}

export function runCommand(name: ShellCommand): void {
    handlers[name]?.();
}

/** One key of a press, as the extension that binds it draws it: `ctrl`, `a`, `⌘`. */
export type KeyChord = readonly string[];

/** What runs each command, as a sequence of presses: `[["ctrl","a"],["c"]]` is ctrl+a, then c. */
const stated = new Map<ShellCommand, readonly KeyChord[]>();
const keyListeners = new Set<() => void>();

function sameKeys(left: readonly KeyChord[] | undefined, right: readonly KeyChord[]): boolean {
    return (
        left !== undefined &&
        left.length === right.length &&
        left.every((chord, at) => {
            const other = right[at];

            return (
                other !== undefined &&
                chord.length === other.length &&
                chord.every((key, index) => key === other[index])
            );
        })
    );
}

/** The keys that run `name` now, or null while no extension states any. */
export function commandKeys(name: ShellCommand): readonly KeyChord[] | null {
    return stated.get(name) ?? null;
}

/**
 * States the keys that run `name`, as the presses they are: `[["ctrl","a"],["c"]]` is ctrl+a, then c.
 * `null` clears them. A command has one owner: the last extension to state its keys keeps them, and
 * clearing them takes that owner's away, so an extension that unloads leaves no label behind.
 */
export function setCommandKeys(name: ShellCommand, keys: readonly KeyChord[] | null): void {
    if (keys === null ? !stated.has(name) : sameKeys(stated.get(name), keys)) {
        return;
    }

    if (keys === null) {
        stated.delete(name);
    } else {
        stated.set(
            name,
            keys.map((chord) => [...chord]),
        );
    }

    for (const listener of keyListeners) {
        listener();
    }
}

export function subscribeCommandKeys(listener: () => void): () => void {
    keyListeners.add(listener);

    return () => {
        keyListeners.delete(listener);
    };
}

/** The keys that run `name`, drawn again when an extension states or clears them. */
export function useCommandKeys(name: ShellCommand): readonly KeyChord[] | null {
    return useSyncExternalStore(subscribeCommandKeys, () => commandKeys(name));
}
