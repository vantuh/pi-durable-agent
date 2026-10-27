export type ProviderError = { title: string; detail?: string; requestId?: string };

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : undefined;
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

/** Providers put their JSON body into the error message: show its message and request id, not the braces. */
export function readProviderError(raw: string): ProviderError {
    const start = raw.indexOf("{");
    let body: Record<string, unknown> | undefined;

    try {
        body = record(JSON.parse(raw.slice(start)));
    } catch {
        body = undefined;
    }

    const inner = record(body?.["error"]);
    const title = text(inner?.["message"]) ?? text(body?.["message"]);

    if (start === -1 || title === undefined) {
        return { title: raw };
    }

    const kind = text(inner?.["type"]) ?? text(body?.["type"]);
    const requestId = text(body?.["request_id"]) ?? text(body?.["requestId"]);
    const prefix = raw.slice(0, start).trim();
    const detail = [prefix, kind].filter((part) => part !== "" && part !== undefined).join(" · ");

    return {
        title,
        ...(detail === "" ? {} : { detail }),
        ...(requestId === undefined ? {} : { requestId }),
    };
}
