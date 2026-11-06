import { useRef, useState } from "react";

import { cwdsOf, folderRows, rowOf } from "@/lib/session-folders.ts";
import { newestFirst } from "@/lib/session-order.ts";
import { useShellCommand } from "@/sdk/commands.ts";

import type { SessionSummary } from "../../../../shared/protocol.ts";
import { folderName } from "../session-parts.tsx";

export function useFolderScope(
    topLevel: SessionSummary[],
    openFolder: string | null,
    onFolder: (id: number) => void,
    expand: () => void,
) {
    const [all, setAll] = useState(true);
    // A folder picked by hand holds until "All": opening a session in a worktree does not move the list.
    const [chosenCwd, setChosenCwd] = useState<string | null>(null);
    const [scopeOpen, setScopeOpen] = useState(false);
    const chosen = useRef<HTMLDivElement | null>(null);

    useShellCommand("folder.pick", () => {
        expand();
        setScopeOpen(true);
        // Opened from the keyboard, the menu marks its first row; the folder in use takes the mark after.
        setTimeout(() => {
            chosen.current?.focus();
        }, 0);
    });
    const folder = chosenCwd ?? openFolder;
    const folders = folderRows(topLevel);

    const latest = (cwds: readonly string[]): SessionSummary[] =>
        topLevel
            .filter((session) => session.cwd !== null && cwds.includes(session.cwd))
            .toSorted(newestFirst);
    // A folder with worktrees shows theirs too; a worktree shows only its own.
    const picked = rowOf(folders, folder);
    const scopeCwds = picked === undefined ? (folder === null ? [] : [folder]) : cwdsOf(picked);
    const scope = all
        ? "All"
        : picked !== undefined && picked.under !== null
          ? `${folderName(picked.under)} / ${folderName(folder)}`
          : folderName(folder);

    const pickFolder = (cwd: string): void => {
        setAll(false);
        setChosenCwd(cwd);

        const [first] = latest([cwd]);

        if (first !== undefined) {
            onFolder(first.id);
        }

        setScopeOpen(false);
    };
    const pickAll = (): void => {
        setAll(true);
        setChosenCwd(null);
    };

    return {
        all,
        folder,
        folders,
        scope,
        scopeCwds,
        scopeOpen,
        setScopeOpen,
        chosen,
        latest,
        pickFolder,
        pickAll,
    };
}
