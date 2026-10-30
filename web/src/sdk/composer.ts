/** Unsent text per session. Extensions may append a draft, never send it. */
const drafts = new Map<string, string>();
const appended = new Set<string>();
const listeners = new Set<() => void>();

/** Words taken from an answer and waiting above a session's composer, oldest first. */
const quotes = new Map<string, string[]>();
const quoteListeners = new Set<() => void>();

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

export function composerQuotes(sessionId: string): string[] {
    return quotes.get(sessionId) ?? [];
}

function tellQuotes(): void {
    for (const listener of quoteListeners) {
        listener();
    }
}

export function addComposerQuote(sessionId: string, text: string): void {
    const quoted = text.trim();
    const current = composerQuotes(sessionId);

    if (quoted === "" || current.includes(quoted)) {
        return;
    }

    quotes.set(sessionId, [...current, quoted]);
    tellQuotes();
}

export function removeComposerQuote(sessionId: string, index: number): void {
    const next = composerQuotes(sessionId).filter((_, at) => at !== index);

    if (next.length === 0) {
        quotes.delete(sessionId);
    } else {
        quotes.set(sessionId, next);
    }

    tellQuotes();
}

export function clearComposerQuotes(sessionId: string): void {
    quotes.delete(sessionId);
    tellQuotes();
}

export function subscribeComposerQuotes(listener: () => void): () => void {
    quoteListeners.add(listener);
    return () => {
        quoteListeners.delete(listener);
    };
}
