/** Unsent text per session. Extensions may append a draft, never send it. */
const drafts = new Map<string, string>();
const appended = new Set<string>();
const listeners = new Set<() => void>();

export function composerDraft(sessionId: string): string {
    return drafts.get(sessionId) ?? "";
}

export function setComposerDraft(sessionId: string, text: string): void {
    if (text === "") {
        drafts.delete(sessionId);
    } else {
        drafts.set(sessionId, text);
    }
    for (const listener of listeners) {
        listener();
    }
}

export function appendComposerDraft(session: number, text: string, id?: string): void {
    const entry = `${String(session)}:${id ?? ""}`;
    if (id !== undefined && appended.has(entry)) {
        return;
    }
    if (id !== undefined) {
        appended.add(entry);
    }
    const key = String(session);
    const before = composerDraft(key);
    setComposerDraft(key, before.trim() === "" ? text : `${before}\n\n${text}`);
}

export function subscribeComposerDraft(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
