/**
 * Readers for the providers' usage endpoints, ported from Pi Pocket's `usage-limits`. They are
 * undocumented endpoints: a change on the provider's side shows as an error row, never a crash.
 * Tokens come in as arguments and are never logged or returned.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ResolveModelAuth } from "../../server/sdk.ts";
import { PROVIDERS, type Bucket, type ProviderUsage } from "./refs.ts";

/** Anthropic reports limit resets only to the Claude Code CLI surface. */
const CLAUDE_CLI_UA = "claude-cli/2.19.1 (external, cli)";
const TIMEOUT_MS = 15_000;

export type Fetch = typeof globalThis.fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

async function getJson(
    fetch: Fetch,
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });

    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${String(response.status)}`);
    }

    const body = record(await response.json());

    if (body === undefined) {
        throw new Error("Unexpected response");
    }

    return body;
}

/** ISO strings from the usage endpoints, epoch seconds or milliseconds elsewhere. */
export function toMs(value: unknown): number | null {
    if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
        const numeric = Number(value);

        return numeric > 0 ? (numeric < 1e12 ? numeric * 1000 : numeric) : null;
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value);

        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
}

function add(
    buckets: Bucket[],
    label: string,
    session: boolean,
    pct: unknown,
    resetsAt: unknown,
): void {
    if (typeof pct === "number" && Number.isFinite(pct)) {
        buckets.push({ label, session, pct, resetsAt: toMs(resetsAt) });
    }
}

/** The token a request would carry: the API key, else the Bearer of the headers. */
function tokenOf(auth: Awaited<ReturnType<ResolveModelAuth>>): string | undefined {
    for (const [key, value] of Object.entries(auth?.headers ?? {})) {
        if (key.toLowerCase() === "authorization" && value !== null) {
            return value.replace(/^Bearer\s+/i, "");
        }
    }

    return auth?.apiKey;
}

const ANTHROPIC_WINDOWS: [string, string][] = [
    ["five_hour", "5 hours"],
    ["seven_day", "7 days"],
    ["seven_day_opus", "7 days Opus"],
    ["seven_day_sonnet", "7 days Sonnet"],
];

export async function readAnthropic(
    resolveAuth: ResolveModelAuth,
    fetch: Fetch,
    signal: AbortSignal,
): Promise<ProviderUsage | undefined> {
    const token = tokenOf(await resolveAuth("anthropic", signal));

    // Usage limits belong to a subscription: an API key has none.
    if (token === undefined || !token.startsWith("sk-ant-oat")) {
        return undefined;
    }

    const body = await getJson(
        fetch,
        "https://api.anthropic.com/api/oauth/usage?skip_spend=1",
        {
            authorization: `Bearer ${token}`,
            "anthropic-beta": "oauth-2025-04-20",
            "user-agent": CLAUDE_CLI_UA,
        },
        signal,
    );
    const buckets: Bucket[] = [];

    for (const [id, label] of ANTHROPIC_WINDOWS) {
        const window = record(body[id]);

        add(buckets, label, id === "five_hour", window?.["utilization"], window?.["resets_at"]);
    }

    return { id: "anthropic", name: "Anthropic", buckets };
}

const OPENCODE_WINDOWS: Record<string, [string, boolean]> = {
    rolling: ["5 hours", true],
    weekly: ["7 days", false],
    monthly: ["Month", false],
};

export async function readOpencodeGo(
    resolveAuth: ResolveModelAuth,
    fetch: Fetch,
    signal: AbortSignal,
): Promise<ProviderUsage | undefined> {
    const token = tokenOf(await resolveAuth("opencode-go", signal));

    if (token === undefined) {
        return undefined;
    }

    const body = await getJson(
        fetch,
        "https://opencode.ai/zen/go/v1/usage",
        { authorization: `Bearer ${token}` },
        signal,
    );
    const buckets: Bucket[] = [];

    for (const [id, value] of Object.entries(record(body["usage"]) ?? {})) {
        const [label, session] = OPENCODE_WINDOWS[id] ?? [id, false];
        const window = record(value);

        add(buckets, label, session, window?.["percent"], window?.["resetsAt"]);
    }

    return { id: "opencode-go", name: "OpenCode Go", buckets };
}

function codexWindow(buckets: Bucket[], label: string, session: boolean, value: unknown): void {
    const window = record(value);

    add(buckets, label, session, window?.["used_percent"], window?.["reset_at"]);
}

/**
 * Pi's OpenAI token is refused by the ChatGPT backend (it answers 401 to it), so this reads the
 * Codex CLI's own sign-in: `$CODEX_HOME/auth.json`, `~/.codex/auth.json` by default.
 */
export async function readCodex(
    fetch: Fetch,
    signal: AbortSignal,
    home: string = process.env["CODEX_HOME"] ?? join(homedir(), ".codex"),
): Promise<ProviderUsage | undefined> {
    let tokens: Record<string, unknown> | undefined;

    try {
        tokens = record(
            record(JSON.parse(await readFile(join(home, "auth.json"), "utf8")))?.["tokens"],
        );
    } catch {
        return undefined;
    }

    const access = tokens?.["access_token"];
    const account = tokens?.["account_id"];

    if (
        typeof access !== "string" ||
        typeof account !== "string" ||
        access === "" ||
        account === ""
    ) {
        return undefined;
    }

    const body = await getJson(
        fetch,
        "https://chatgpt.com/backend-api/wham/usage",
        { authorization: `Bearer ${access}`, "chatgpt-account-id": account },
        signal,
    );
    const limit = record(body["rate_limit"]);
    const buckets: Bucket[] = [];

    codexWindow(buckets, "5 hours", true, limit?.["primary_window"]);
    codexWindow(buckets, "7 days", false, limit?.["secondary_window"]);

    const plan = body["plan_type"];

    return {
        id: "codex",
        name: typeof plan === "string" && plan !== "" ? `OpenAI Codex (${plan})` : "OpenAI Codex",
        buckets,
    };
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

/** kiro-cli prints the report to stderr when it is not attached to a terminal. */
function runKiroUsage(signal: AbortSignal): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        execFile(
            "kiro-cli",
            ["chat", "--no-interactive", "/usage"],
            { signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) },
            (error, stdout, stderr) => {
                if (error === null) {
                    resolve(stdout + stderr);
                } else if ("code" in error && error.code === "ENOENT") {
                    resolve(undefined);
                } else {
                    reject(new Error("kiro-cli /usage failed"));
                }
            },
        );
    });
}

/**
 * Plan credits are not on the ACP wire, so this reads what `kiro-cli /usage` prints. The format is
 * the CLI's, not an API: a change shows as an error row. Without kiro-cli the provider is absent.
 */
export async function readKiro(
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<string | undefined> = runKiroUsage,
): Promise<ProviderUsage | undefined> {
    const raw = await run(signal);

    if (raw === undefined) {
        return undefined;
    }

    const text = raw.replace(ANSI, "");
    const header = /Estimated Usage \| resets on ([^|]+) \| (.+)/.exec(text);
    const pct = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(text)?.[1];

    if (header === null || pct === undefined) {
        throw new Error("Unexpected kiro-cli output");
    }

    const buckets: Bucket[] = [];

    add(buckets, "Credits", true, Number(pct), header[1]?.trim());

    return { id: "kiro", name: `Kiro (${header[2]?.trim() ?? ""})`, buckets };
}

/** Every provider this machine is signed in to; one that fails is a row with an error. */
export async function collect(
    resolveAuth: ResolveModelAuth,
    fetch: Fetch,
    signal: AbortSignal,
    options: {
        codexHome?: string;
        hidden?: readonly string[];
        kiro?: (signal: AbortSignal) => Promise<string | undefined>;
    } = {},
): Promise<ProviderUsage[]> {
    const readers: Record<string, () => Promise<ProviderUsage | undefined>> = {
        anthropic: () => readAnthropic(resolveAuth, fetch, signal),
        "opencode-go": () => readOpencodeGo(resolveAuth, fetch, signal),
        codex: () => readCodex(fetch, signal, options.codexHome),
        kiro: () => readKiro(signal, options.kiro),
    };
    // A hidden provider is not asked at all.
    const jobs = PROVIDERS.filter((each) => !(options.hidden ?? []).includes(each.id)).map(
        (each) => [each.id, each.name, readers[each.id]?.() ?? Promise.resolve(undefined)] as const,
    );
    const settled = await Promise.allSettled(jobs.map(([, , job]) => job));
    const out: ProviderUsage[] = [];

    settled.forEach((result, index) => {
        const [id, name] = jobs[index] ?? ["", ""];

        if (result.status === "fulfilled") {
            if (result.value !== undefined) {
                out.push(result.value);
            }
        } else {
            out.push({
                id,
                name,
                buckets: [],
                error: result.reason instanceof Error ? result.reason.message : "Unavailable",
            });
        }
    });

    return out;
}
