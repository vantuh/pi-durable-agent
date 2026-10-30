import { useEffect } from "react";

/** What the shell can be told to do from outside it, by name. */
export type ShellCommand = "session.new" | "folder.pick";

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
