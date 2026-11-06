import type { NewSessionCollected } from "@/sdk/types.ts";

export const NAME = "name";
export const PATH = "path";

export function nameOf(collected: NewSessionCollected | null): string {
    const name: unknown = collected?.[NAME];

    return typeof name === "string" ? name.trim() : "";
}

/** The worktree the person chose instead of the picked folder, or null for the folder as picked. */
export function chosenOf(collected: NewSessionCollected | null): string | null {
    const path: unknown = collected?.[PATH];

    return typeof path === "string" && path !== "" ? path : null;
}
