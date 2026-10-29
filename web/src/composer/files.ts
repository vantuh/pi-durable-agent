import type { Pending } from "../ui/attachments.tsx";

/** Unsent attachments per session, so they survive the composer being remounted when the session changes. */
const files = new Map<string, Pending[]>();

export function composerFiles(sessionId: string): Pending[] {
    return files.get(sessionId) ?? [];
}

export function setComposerFiles(sessionId: string, next: Pending[]): void {
    if (next.length === 0) {
        files.delete(sessionId);
    } else {
        files.set(sessionId, next);
    }
}
