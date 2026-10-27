import { actionRef } from "../../shared/extension-api.ts";

/** One rate-limit window: a share of its limit and, when the provider says, when it resets. */
export type Bucket = {
    label: string;
    /** The five-hour session window: the one the status bar shows. */
    session: boolean;
    pct: number;
    /** Epoch ms. */
    resetsAt: number | null;
};

export type ProviderUsage = {
    /** `anthropic`, `opencode-go` or `codex`. */
    id: string;
    name: string;
    buckets: Bucket[];
    /** Set instead of buckets when the provider could not be read. */
    error?: string;
};

export type UsageResult = { providers: ProviderUsage[]; at: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bucket(value: unknown): Bucket {
    if (
        isRecord(value) &&
        typeof value["label"] === "string" &&
        typeof value["session"] === "boolean" &&
        typeof value["pct"] === "number" &&
        (typeof value["resetsAt"] === "number" || value["resetsAt"] === null)
    ) {
        return {
            label: value["label"],
            session: value["session"],
            pct: value["pct"],
            resetsAt: value["resetsAt"],
        };
    }
    throw new Error("Invalid usage window");
}

function parseProvider(value: unknown): ProviderUsage {
    if (
        isRecord(value) &&
        typeof value["id"] === "string" &&
        typeof value["name"] === "string" &&
        Array.isArray(value["buckets"])
    ) {
        return {
            id: value["id"],
            name: value["name"],
            buckets: value["buckets"].map(bucket),
            ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
        };
    }
    throw new Error("Invalid provider usage");
}

function parse(value: unknown): UsageResult {
    if (isRecord(value) && Array.isArray(value["providers"]) && typeof value["at"] === "number") {
        return { providers: value["providers"].map(parseProvider), at: value["at"] };
    }
    throw new Error("Invalid usage result");
}

export const providers = actionRef<{ fresh?: boolean } | undefined, UsageResult>(
    "usage-limits",
    "providers",
    parse,
);

const READERS: Record<string, string | undefined> = {
    anthropic: "anthropic",
    "opencode-go": "opencode-go",
    openai: "codex",
    "openai-codex": "codex",
};

/** Pi's provider id → the id of the reader that serves it. */
export function readerFor(model: string | null): string | null {
    return READERS[model?.split("/")[0] ?? ""] ?? null;
}
