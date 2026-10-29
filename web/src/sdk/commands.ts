import { useEffect } from "react";

/** What the shell can be told to do from outside it, by name. */
export type ShellCommand = "session.new" | "folder.pick";

let handlers: Partial<Record<ShellCommand, () => void>> = {};

/** The shell calls this once, with the current handlers. */
export function useShellCommands(next: Record<ShellCommand, () => void>): void {
    useEffect(() => {
        handlers = next;

        return () => {
            handlers = {};
        };
    });
}

export function runCommand(name: ShellCommand): void {
    handlers[name]?.();
}
