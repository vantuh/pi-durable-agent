const HISTORY_KEY = "composer-history";
const HISTORY_MAX = 100;

// Sent messages are remembered per session, so an empty chat never recalls another chat's text.
export function loadHistory(sessionId: string): string[] {
    try {
        const parsed: unknown = JSON.parse(
            localStorage.getItem(`${HISTORY_KEY}:${sessionId}`) ?? "[]",
        );

        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [];
    } catch {
        return [];
    }
}

export function remember(sessionId: string, text: string): void {
    const past = loadHistory(sessionId);

    if (past.at(-1) === text) {
        return;
    }

    try {
        localStorage.setItem(
            `${HISTORY_KEY}:${sessionId}`,
            JSON.stringify([...past, text].slice(-HISTORY_MAX)),
        );
    } catch {
        // History is a convenience; storage may be full or blocked.
    }
}
