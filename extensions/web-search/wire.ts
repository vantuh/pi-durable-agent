/**
 * Reading provider responses: the Server-Sent Events framing and the small guards the parsers share.
 *
 * Ported in part from pi-web-search (MIT, ttttmr) `src/providers/sse.ts`.
 */

export type Source = { readonly url: string; readonly title: string };

export type Found = {
    readonly answer: string;
    readonly sources: readonly Source[];
    /** The model that answered, for the "Searched with" line. */
    readonly model: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object, or an empty one: a missing field then reads as undefined without a check at each step. */
export function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

export function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

/** The JSON `data:` payloads of an event stream, in order. Lines that are not JSON are skipped. */
export function parseSse(body: string): unknown[] {
    const events: unknown[] = [];

    for (const block of body.split(/\r?\n\r?\n/)) {
        const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");

        if (data === "" || data === "[DONE]") {
            continue;
        }

        try {
            events.push(JSON.parse(data));
        } catch {
            // A partial or comment-only block carries nothing to read.
        }
    }

    return events;
}

/** The error a failed request raises: status and a trimmed body, never headers. */
export async function httpError(response: Response): Promise<Error> {
    const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim();

    return new Error(`HTTP ${response.status}${body === "" ? "" : `: ${body.slice(0, 200)}`}`);
}

/** What stands for a link that came without a title: its host and path. */
export function labelOf(url: string): string {
    try {
        const { hostname, pathname } = new URL(url);

        return hostname + (pathname === "/" ? "" : pathname);
    } catch {
        return url;
    }
}

export function sourceOf(url: string, title?: unknown): Source {
    return { url, title: str(title) ?? labelOf(url) };
}

/** First occurrence wins; the order of citation is the order of the list. */
export function uniqueSources(sources: readonly Source[]): Source[] {
    const seen = new Set<string>();

    return sources.filter((source) => !seen.has(source.url) && seen.add(source.url));
}
